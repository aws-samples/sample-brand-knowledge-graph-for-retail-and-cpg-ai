# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""``ontology-rag network-cleanup``: the network a deleted stack leaves behind, and its deletion.

The stack runs its Lambda functions and both agents in a VPC of its own. Amazon Bedrock AgentCore
removes an agent's network interfaces up to 8 hours after the agent is deleted, and nobody else may
delete them (an AWS service's own interface answers ``AuthFailure``), so a delete of the whole
stack would fail on the subnets, the security groups and the VPC. The stack therefore keeps those
on delete, with the flow log, its log group and its role (none of them costs anything per hour),
and deletes everything billed per hour. This command finds what it kept and, once the interfaces
are gone, deletes it.

Which VPCs: those tagged ``project=multimodal-ai-knowledge-graph`` whose own tag
``multimodal-ai-knowledge-graph:stack-id`` (the stack's ARN) names the stack, minus the VPCs the
live stack owns now. So the VPC of a destroyed stack, or one a rolled-back update left, is a
leftover, and the VPC the stack uses is never one.

Report (the default): per leftover VPC its network interfaces and what holds them, and the number
of VPCs in the Region against the default quota of 5. ``--delete``: per leftover VPC, in the order
AWS needs (NAT gateways and endpoints, detached Lambda interfaces, flow logs with their role and
log group, security groups, subnets, route tables, internet gateways, the VPC), printing each call
before it is made. ``--wait MINUTES`` (with ``--delete``) looks again every 5 minutes while
interfaces are held.

Exit codes: 0 nothing is held (or left), 3 interfaces still hold a VPC, 1 an error; with several
VPCs the worst one wins (1 over 3 over 0).
"""

from __future__ import annotations

import time
from collections import defaultdict

from botocore.exceptions import BotoCoreError, ClientError, SSOError, TokenRetrievalError

from ontology_rag.errors import aws_error_code, aws_message

DEFAULT_STACK = "MultimodalAiKnowledgeGraph"
PROJECT_KEY, PROJECT = "project", "multimodal-ai-knowledge-graph"
# The stack's own tag on every network resource it creates (value: AWS::StackId, the stack's ARN).
STACK_TAG = "multimodal-ai-knowledge-graph:stack-id"
VPC_QUOTA = 5  # VPCs per Region by default, the default VPC included
POLL_MINUTES = 5  # --wait looks again this often
GONE_POLL_S, GONE_POLLS = 15, 40  # NAT gateways and VPC endpoints: up to 10 minutes to go
OK, HELD, FAILED = 0, 3, 1
# CloudFormation's states of a resource the stack no longer owns (DELETE_SKIPPED: kept by its
# Retain policy on a delete, a rollback or a replacement).
GONE = {"DELETE_COMPLETE", "DELETE_SKIPPED"}
# Error codes of credentials that ran out (EC2 answers RequestExpired).
EXPIRED = {"ExpiredToken", "ExpiredTokenException", "RequestExpired"}


def run(
    stack: str,
    *,
    delete: bool,
    wait_minutes: int,
    ec2=None,
    cloudformation=None,
    logs=None,
    iam=None,
    sts=None,
    clients=None,
    out=print,
    sleep=time.sleep,
) -> int:
    """Report the VPCs ``stack`` left behind, or with ``delete`` delete them; the exit code.

    Pass the five clients, or ``clients``: a function that returns them as a dict (keys ``ec2``,
    ``cloudformation``, ``logs``, ``iam``, ``sts``), called before every look. The CLI passes
    :func:`new_clients`, so each look of ``wait_minutes`` (``--wait``) runs in a new session and
    picks up credentials refreshed meanwhile."""
    if wait_minutes and not delete:
        raise ValueError("--wait needs --delete")
    if clients is None:
        given = {"ec2": ec2, "cloudformation": cloudformation, "logs": logs, "iam": iam, "sts": sts}
        if None in given.values():
            raise TypeError("pass the five clients or clients=")
        clients = lambda: given
    waited = 0
    while True:
        try:
            code = _look(stack, delete, clients(), out, sleep)
        except (ClientError, BotoCoreError) as exc:
            out("credentials expired; run again" if _expired(exc) else f"error: {exc}")
            return FAILED
        except RuntimeError as exc:  # the stack is changing, a NAT gateway that does not go
            out(f"error: {exc}")
            return FAILED
        if code != HELD or waited + POLL_MINUTES > wait_minutes:
            break
        out(f"looking again in {POLL_MINUTES} minutes ({waited} of {wait_minutes} waited)")
        sleep(POLL_MINUTES * 60)
        waited += POLL_MINUTES
    if code == HELD and wait_minutes:
        out(f"still held after {waited} minutes; run again later")
    return code


def new_clients(region: str) -> dict:
    """The five clients of a new boto3 session in ``region``. A session keeps the credentials it
    read first, so a long ``--wait`` builds a new one for every look."""
    import boto3

    session = boto3.Session(region_name=region)
    return {name: session.client(name) for name in ("ec2", "cloudformation", "logs", "iam", "sts")}


def _look(stack: str, delete: bool, clients: dict, out, sleep) -> int:
    """One look: who and where, what the live stack owns, the leftovers, and per leftover the
    report or the deletes; the worst exit code."""
    ec2 = clients["ec2"]
    me = clients["sts"].get_caller_identity()
    region = ec2.meta.region_name
    mode = "" if delete else " · report only (add --delete to delete)"
    out(f"account {me['Account']} · {region} · stack {stack}{mode}")
    live = live_resources(clients["cloudformation"], stack)
    live_vpcs = sorted(pid for pid, kind in live.items() if kind == "AWS::EC2::VPC")
    out(f"the live stack owns {', '.join(live_vpcs)}" if live_vpcs else "no live stack owns a VPC")
    vpcs = leftover_vpcs(ec2, stack, live)
    if not vpcs:
        out(f"no VPC is left over by {stack}")
    codes = []
    for vpc in vpcs:
        out(f"{vpc['vpc_id']}, left by {vpc['stack_id']}")
        if delete:
            codes.append(
                delete_vpc(
                    vpc,
                    live=live,
                    ec2=ec2,
                    logs=clients["logs"],
                    iam=clients["iam"],
                    out=out,
                    sleep=sleep,
                )
            )
        else:
            codes.append(_report_vpc(ec2, vpc["vpc_id"], out))
    count = len(_pages(ec2.describe_vpcs, "Vpcs"))
    out(f"VPCs in {region}: {count}; the default quota is {VPC_QUOTA}, the default VPC included")
    return _worst(codes)


# ---------------------------------------------------------------------- which VPCs
def live_resources(cloudformation, stack: str) -> dict[str, str]:
    """What the live stack owns now: ``{physical id: resource type}`` of its resources in a state
    other than DELETE_COMPLETE or DELETE_SKIPPED; ``{}`` when no stack has that name.

    Only the ValidationError that says the stack does not exist means "no stack"; any other error
    propagates, and a stack that is changing (``*_IN_PROGRESS``) is a RuntimeError, so nothing is
    deleted while a VPC may move between owned and left over. ListStackResources pages through
    every resource; DescribeStackResources returns only the first 100, the stack has about that
    many, and the VPC may not be among them. Besides the VPCs, the deletes check the roles,
    log groups and Elastic IP addresses against this: a VPC a rolled-back update left can share
    them with the live stack."""
    try:
        status = cloudformation.describe_stacks(StackName=stack)["Stacks"][0]["StackStatus"]
    except ClientError as exc:
        if aws_error_code(exc) == "ValidationError" and "does not exist" in str(exc):
            return {}
        raise
    if status.endswith("_IN_PROGRESS"):
        raise RuntimeError(f"{stack} is {status}; run again when it is done")
    rows = _pages(cloudformation.list_stack_resources, "StackResourceSummaries", StackName=stack)
    return {
        row["PhysicalResourceId"]: row["ResourceType"]
        for row in rows
        if row["ResourceStatus"] not in GONE and row.get("PhysicalResourceId")
    }


def leftover_vpcs(ec2, stack: str, live: dict[str, str]) -> list[dict]:
    """The VPCs ``stack`` left behind, as ``{"vpc_id", "stack_id"}``: tagged
    ``project=multimodal-ai-knowledge-graph``, with an own stack-id tag whose stack name is
    ``stack``, and not owned by the live stack."""
    tagged = _pages(
        ec2.describe_vpcs,
        "Vpcs",
        Filters=[
            {"Name": f"tag:{PROJECT_KEY}", "Values": [PROJECT]},
            {"Name": "tag-key", "Values": [STACK_TAG]},
        ],
    )
    found = []
    for vpc in tagged:
        tags = _tags(vpc)
        stack_id = tags.get(STACK_TAG, "")
        if tags.get(PROJECT_KEY) != PROJECT or stack_name(stack_id) != stack:
            continue
        if vpc["VpcId"] not in live:
            found.append({"vpc_id": vpc["VpcId"], "stack_id": stack_id})
    return sorted(found, key=lambda v: v["vpc_id"])


def stack_name(stack_id: str) -> str:
    """The stack name inside a stack ARN (``arn:...:stack/<name>/<uuid>``); ``""`` for any other
    value."""
    _, found, rest = stack_id.partition(":stack/")
    return rest.split("/", 1)[0] if found else ""


# ---------------------------------------------------------------------- what holds a VPC
def interfaces(ec2, vpc_id: str) -> list[dict]:
    """Every network interface in the VPC. EC2 leaves out the ones an AWS service manages unless
    the call asks for them (IncludeManagedResources=True); a service such as AgentCore may keep
    one, and missing it would make the VPC look free."""
    return _pages(
        ec2.describe_network_interfaces,
        "NetworkInterfaces",
        Filters=[{"Name": "vpc-id", "Values": [vpc_id]}],
        IncludeManagedResources=True,
    )


def held_interfaces(ec2, enis: list[dict], *, delete: bool, out=print) -> list[dict]:
    """Of a VPC's network interfaces, those that keep it from being deleted. Only a detached
    Lambda interface (``lambda``, ``available``) is the account's to delete: Lambda leaves one
    behind when the function's role went before Lambda deleted it. With ``delete`` those are
    deleted; one that answers ``AuthFailure`` (a service's own) or "currently in use" (attached
    again meanwhile) is held like the rest."""
    held = []
    for eni in enis:
        if eni.get("InterfaceType") != "lambda" or eni.get("Status") != "available":
            held.append(eni)
            continue
        if not delete:
            continue  # --delete deletes it
        try:
            _call(
                out,
                ec2,
                "ec2",
                "delete_network_interface",
                NetworkInterfaceId=eni["NetworkInterfaceId"],
            )
        except ClientError as exc:
            if aws_error_code(exc) == "AuthFailure" or "currently in use" in str(exc):
                out(f"  held: {aws_message(exc)}")
                held.append(eni)
            elif aws_error_code(exc) != "InvalidNetworkInterfaceID.NotFound":
                raise
    return held


def _report_vpc(ec2, vpc_id: str, out) -> int:
    enis = interfaces(ec2, vpc_id)
    _print_interfaces(enis, out)
    held = held_interfaces(ec2, enis, delete=False, out=out)
    if held:
        _explain(held, out)
        return HELD
    out(f"  nothing holds {vpc_id}; --delete deletes it")
    return OK


def _print_interfaces(enis: list[dict], out) -> None:
    """The interfaces grouped by their raw type, status and requester."""
    out(f"  network interfaces: {len(enis) or 'none'}")
    groups: dict[tuple, list[str]] = defaultdict(list)
    for eni in enis:
        key = (
            str(eni.get("InterfaceType")),
            str(eni.get("Status")),
            eni.get("RequesterId") or "none",
        )
        groups[key].append(eni["NetworkInterfaceId"])
    for (kind, status, requester), ids in sorted(groups.items()):
        out(f"    {len(ids)} x {kind}, {status}, requester {requester}: {', '.join(ids)}")


def _explain(held: list[dict], out) -> None:
    """Why the held interfaces are still there and when they go, per kind."""
    lambdas = [e for e in held if e.get("InterfaceType") == "lambda"]
    agents = [e for e in held if e not in lambdas and _is_agentcore(e)]
    if agents:
        out(
            f"  {len(agents)} AgentCore Runtime interface(s): AgentCore removes them up to "
            "8 hours after the stack's delete"
        )
    if lambdas:
        out(
            f"  {len(lambdas)} Lambda interface(s): Lambda deletes them up to 20 minutes after "
            "their function"
        )
    others: dict[str, list[dict]] = defaultdict(list)
    for eni in held:
        if eni not in lambdas and eni not in agents:
            others[eni.get("RequesterId") or ""].append(eni)
    for requester, enis in sorted(others.items()):
        kinds = ", ".join(sorted({str(e.get("InterfaceType")) for e in enis}))
        if requester:
            out(
                f"  {len(enis)} interface(s) of type {kinds}: they go when requester {requester} "
                "releases them"
            )
        else:
            out(
                f"  {len(enis)} interface(s) of type {kinds}, created in the account: delete them "
                "or what uses them"
            )


def _is_agentcore(eni: dict) -> bool:
    """AgentCore Runtime's interfaces have the "agentic AI" interface type (AWS Knowledge Center);
    the API's raw value for it is not documented, so a type or description naming an agent
    counts."""
    return "agent" in f"{eni.get('InterfaceType', '')} {eni.get('Description', '')}".lower()


# ---------------------------------------------------------------------- the deletes
def delete_vpc(
    vpc: dict, *, live: dict[str, str], ec2, logs, iam, out=print, sleep=time.sleep
) -> int:
    """Delete one leftover VPC and what belongs to it, in the order AWS allows (each step removes
    what the next one depends on). Everything inside the VPC belongs to it; outside it only the
    flow log's log group and role do, and only with the VPC's own stack-id tag value. Nothing the
    live stack owns is touched. 0 when the VPC is gone, 3 when interfaces still hold it (nothing
    after them is deleted), 1 when a call failed (the resource is named)."""
    vpc_id, stack_id = vpc["vpc_id"], vpc["stack_id"]
    in_vpc = [{"Name": "vpc-id", "Values": [vpc_id]}]
    own = [{"Name": f"tag:{STACK_TAG}", "Values": [stack_id]}]
    try:
        # 1. NAT gateways and VPC endpoints with the own tag, until they are gone; then the
        # Elastic IP addresses with the own tag that nothing uses any more.
        nats = _pages(ec2.describe_nat_gateways, "NatGateways", Filter=in_vpc + own)
        nats = [n for n in nats if n["State"] != "deleted"]
        for nat in nats:
            if nat["State"] != "deleting":
                _call(out, ec2, "ec2", "delete_nat_gateway", NatGatewayId=nat["NatGatewayId"])
        endpoints = _pages(ec2.describe_vpc_endpoints, "VpcEndpoints", Filters=in_vpc + own)
        endpoints = [e for e in endpoints if e["State"].lower() != "deleted"]
        doomed = [e["VpcEndpointId"] for e in endpoints if e["State"].lower() != "deleting"]
        if doomed:
            _call(out, ec2, "ec2", "delete_vpc_endpoints", VpcEndpointIds=doomed)
        if nats or endpoints:
            _wait_until_gone(ec2, in_vpc + own, out, sleep)
        for address in ec2.describe_addresses(Filters=own)["Addresses"]:
            if address.get("AssociationId"):
                continue
            if {address.get("AllocationId"), address.get("PublicIp")} & live.keys():
                out(f"  kept {address['AllocationId']}: the live stack owns it")
                continue
            _call(out, ec2, "ec2", "release_address", AllocationId=address["AllocationId"])

        # 2. Detached Lambda interfaces; any other interface stops this VPC here.
        held = held_interfaces(ec2, interfaces(ec2, vpc_id), delete=True, out=out)
        if held:
            _print_interfaces(held, out)
            _explain(held, out)
            out(f"  {vpc_id} stays until they are gone; run again later or add --wait MINUTES")
            return HELD

        # 3. The flow logs, then their delivery roles and their log groups.
        flows = _pages(
            ec2.describe_flow_logs, "FlowLogs", Filter=[{"Name": "resource-id", "Values": [vpc_id]}]
        )
        if flows:
            _call(out, ec2, "ec2", "delete_flow_logs", FlowLogIds=[f["FlowLogId"] for f in flows])
        for arn in sorted(
            {f["DeliverLogsPermissionArn"] for f in flows if f.get("DeliverLogsPermissionArn")}
        ):
            _delete_role(iam, arn.rsplit("/", 1)[-1], stack_id, live, out)
        for name in sorted({f["LogGroupName"] for f in flows if f.get("LogGroupName")}):
            _delete_log_group(logs, name, stack_id, live, out)

        # 4. The rules of the VPC's own security groups that name another group (Endpoints
        # admits Callers), then the groups. The default group goes with the VPC.
        groups = _pages(ec2.describe_security_groups, "SecurityGroups", Filters=in_vpc)
        groups = [g for g in groups if g["GroupName"] != "default"]
        for group in groups:
            for direction, key in (("ingress", "IpPermissions"), ("egress", "IpPermissionsEgress")):
                refs = [_group_refs(r) for r in group.get(key, []) if r.get("UserIdGroupPairs")]
                if refs:
                    _call(
                        out,
                        ec2,
                        "ec2",
                        f"revoke_security_group_{direction}",
                        GroupId=group["GroupId"],
                        IpPermissions=refs,
                    )
        for group in groups:
            _call(out, ec2, "ec2", "delete_security_group", GroupId=group["GroupId"])

        # 5. The subnets.
        for subnet in _pages(ec2.describe_subnets, "Subnets", Filters=in_vpc):
            _call(out, ec2, "ec2", "delete_subnet", SubnetId=subnet["SubnetId"])

        # 6. Route tables other than the main one (it goes with the VPC). One associated with a
        # gateway is only reported; the VPC's delete then fails and names the VPC.
        for table in _pages(ec2.describe_route_tables, "RouteTables", Filters=in_vpc):
            links = table.get("Associations", [])
            if any(link.get("Main") for link in links):
                continue
            gateways = [link["GatewayId"] for link in links if link.get("GatewayId")]
            if gateways:
                out(f"  kept {table['RouteTableId']}: associated with {', '.join(gateways)}")
                continue
            _call(out, ec2, "ec2", "delete_route_table", RouteTableId=table["RouteTableId"])

        # 7. Internet gateways attached to the VPC with the own tag: detach, then delete.
        attached = [{"Name": "attachment.vpc-id", "Values": [vpc_id]}] + own
        for gateway in _pages(ec2.describe_internet_gateways, "InternetGateways", Filters=attached):
            gateway_id = gateway["InternetGatewayId"]
            _call(
                out,
                ec2,
                "ec2",
                "detach_internet_gateway",
                InternetGatewayId=gateway_id,
                VpcId=vpc_id,
            )
            _call(out, ec2, "ec2", "delete_internet_gateway", InternetGatewayId=gateway_id)

        # 8. The VPC.
        _call(out, ec2, "ec2", "delete_vpc", VpcId=vpc_id)
    except ClientError as exc:
        if _expired(exc):
            raise
        out(f"  stopped: {exc}")
        return FAILED
    except RuntimeError as exc:
        out(f"  stopped: {exc}")
        return FAILED
    out(f"  deleted {vpc_id}")
    return OK


def _wait_until_gone(ec2, filters: list[dict], out, sleep) -> None:
    """Wait until the NAT gateways and VPC endpoints ``filters`` match are deleted (a NAT gateway
    takes about a minute); a RuntimeError after 10 minutes."""
    for _ in range(GONE_POLLS):
        nats = _pages(ec2.describe_nat_gateways, "NatGateways", Filter=filters)
        endpoints = _pages(ec2.describe_vpc_endpoints, "VpcEndpoints", Filters=filters)
        left = [n["NatGatewayId"] for n in nats if n["State"] != "deleted"]
        left += [e["VpcEndpointId"] for e in endpoints if e["State"].lower() != "deleted"]
        if not left:
            return
        out(f"  waiting for {', '.join(left)} to be deleted")
        sleep(GONE_POLL_S)
    minutes = GONE_POLLS * GONE_POLL_S // 60
    raise RuntimeError(f"{', '.join(left)} not deleted after {minutes} minutes; run again")


def _delete_role(iam, name: str, stack_id: str, live: dict[str, str], out) -> None:
    """A flow log's delivery role with the VPC's own stack-id tag value: its inline policies
    deleted and its managed policies detached first (IAM refuses to delete a role that has
    any)."""
    if name in live:
        out(f"  kept role {name}: the live stack owns it")
        return
    try:
        tags = {t["Key"]: t["Value"] for t in iam.list_role_tags(RoleName=name)["Tags"]}
    except ClientError as exc:
        if aws_error_code(exc) == "NoSuchEntity":
            return
        raise
    if tags.get(STACK_TAG) != stack_id:
        out(f"  kept role {name}: its {STACK_TAG} tag is not {stack_id}")
        return
    for policy in iam.list_role_policies(RoleName=name)["PolicyNames"]:
        _call(out, iam, "iam", "delete_role_policy", RoleName=name, PolicyName=policy)
    for policy in iam.list_attached_role_policies(RoleName=name)["AttachedPolicies"]:
        _call(out, iam, "iam", "detach_role_policy", RoleName=name, PolicyArn=policy["PolicyArn"])
    _call(out, iam, "iam", "delete_role", RoleName=name)


def _delete_log_group(logs, name: str, stack_id: str, live: dict[str, str], out) -> None:
    """A flow log's log group with the VPC's own stack-id tag value."""
    if name in live:
        out(f"  kept log group {name}: the live stack owns it")
        return
    # The log group is in the partition, Region and account of the stack that made it.
    _, partition, _, region, account = stack_id.split(":")[:5]
    arn = f"arn:{partition}:logs:{region}:{account}:log-group:{name}"
    try:
        tags = logs.list_tags_for_resource(resourceArn=arn)["tags"]
    except ClientError as exc:
        if aws_error_code(exc) == "ResourceNotFoundException":
            return
        raise
    if tags.get(STACK_TAG) != stack_id:
        out(f"  kept log group {name}: its {STACK_TAG} tag is not {stack_id}")
        return
    _call(out, logs, "logs", "delete_log_group", logGroupName=name)


def _group_refs(rule: dict) -> dict:
    """The part of a security group rule that names other groups, as the revoke calls take it."""
    kept = {k: rule[k] for k in ("IpProtocol", "FromPort", "ToPort") if k in rule}
    return {
        **kept,
        "UserIdGroupPairs": [{"GroupId": p["GroupId"]} for p in rule["UserIdGroupPairs"]],
    }


# ---------------------------------------------------------------------- helpers
def _call(out, client, service: str, op: str, **params):
    """Print a change, then make it, so the reader sees each call before AWS gets it. A refusal
    because something still depends on the resource (``DependencyViolation``, ``DeleteConflict``)
    becomes a RuntimeError that names the resource."""
    out(f"  {service}.{op}({', '.join(f'{k}={v!r}' for k, v in params.items())})")
    try:
        return getattr(client, op)(**params)
    except ClientError as exc:
        if aws_error_code(exc) in ("DependencyViolation", "DeleteConflict"):
            resource = next(iter(params.values()))
            raise RuntimeError(f"{resource} still has a dependency: {aws_message(exc)}") from exc
        raise


def _pages(call, key: str, **params) -> list[dict]:
    """Every item of a paginated list or describe call (``NextToken``), so a long answer is never
    cut short."""
    items, token = [], None
    while True:
        page = call(**params, **({"NextToken": token} if token else {}))
        items += page.get(key, [])
        token = page.get("NextToken")
        if not token:
            return items


def _tags(resource: dict) -> dict[str, str]:
    return {t["Key"]: t["Value"] for t in resource.get("Tags") or resource.get("TagSet") or []}


def _expired(exc: Exception) -> bool:
    """Credentials that ran out (a session token, an SSO session), as against any other error."""
    return aws_error_code(exc) in EXPIRED or isinstance(exc, (TokenRetrievalError, SSOError))


def _worst(codes: list[int]) -> int:
    return FAILED if FAILED in codes else HELD if HELD in codes else OK
