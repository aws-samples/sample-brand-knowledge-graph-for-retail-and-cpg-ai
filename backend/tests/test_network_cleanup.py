# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""``ontology-rag network-cleanup`` (network_cleanup.py) against fakes of its five AWS clients that
answer as AWS does: EC2 leaves out the interfaces a service manages unless the call asks for
them, refuses to delete what something still depends on (``DependencyViolation``) and answers
``AuthFailure`` to a delete of a service's own interface; IAM refuses to delete a role that still
has policies (``DeleteConflict``); CloudFormation says a stack it does not know "does not exist".
One World holds the account, so the client sets ``--wait`` builds for each look see the same
resources; it records every call in order."""

from __future__ import annotations

import copy
import functools
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError, UnauthorizedSSOTokenError

from ontology_rag import cli, network_cleanup
from ontology_rag.network_cleanup import PROJECT, STACK_TAG

ACCOUNT = "111111111111"
STACK = "MultimodalAiKnowledgeGraph"
ARN = f"arn:aws:cloudformation:us-east-1:{ACCOUNT}:stack"
OLD = f"{ARN}/{STACK}/0ld00000-0000-0000-0000-000000000000"  # a stack destroyed earlier
LIVE = f"{ARN}/{STACK}/11ve1111-1111-1111-1111-111111111111"  # the stack deployed now
OTHER = f"{ARN}/SomeOtherStack/0the2222-2222-2222-2222-222222222222"
CHANGES = ("delete_", "release_", "revoke_", "detach_")


def _error(code: str, message: str, op: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, op)


def _tags(item: dict) -> dict:
    return {t["Key"]: t["Value"] for t in item.get("Tags") or item.get("TagSet") or []}


def _matches(item: dict, filters: list[dict] | None) -> bool:
    """EC2's filters as the cleanup uses them (all must match; any value of one)."""
    for f in filters or []:
        name, values = f["Name"], set(f["Values"])
        if name.startswith("tag:"):
            have = {_tags(item).get(name[4:])}
        elif name == "tag-key":
            have = set(_tags(item))
        elif name == "vpc-id":
            have = {item.get("VpcId")}
        elif name == "attachment.vpc-id":
            have = {a["VpcId"] for a in item.get("Attachments", [])}
        elif name == "resource-id":
            have = {item.get("ResourceId")}
        else:
            raise AssertionError(f"the fake has no filter {name}")
        if not have & values:
            return False
    return True


def _page(items: list[dict], key: str, token: str | None, size: int = 2) -> dict:
    """Two items per page, so every list the cleanup reads has to be paged through."""
    start = int(token or 0)
    page = {key: copy.deepcopy(items[start : start + size])}
    if start + size < len(items):
        page["NextToken"] = str(start + size)
    return page


class World:
    """The account: its resources by id, the live stack, errors to raise, every call in order."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.sleeps: list[float] = []
        self.fail: dict[str, Exception] = {}
        self.stack: dict | None = None  # {"StackId", "StackStatus", "resources": [...]}
        self.vpcs: dict[str, dict] = {}
        self.subnets: dict[str, dict] = {}
        self.route_tables: dict[str, dict] = {}
        self.groups: dict[str, dict] = {}
        self.enis: dict[str, dict] = {}
        self.nats: dict[str, dict] = {}
        self.endpoints: dict[str, dict] = {}
        self.addresses: dict[str, dict] = {}
        self.igws: dict[str, dict] = {}
        self.flow_logs: dict[str, dict] = {}
        self.roles: dict[str, dict] = {}
        self.log_groups: dict[str, dict] = {}

    def clients(self) -> dict:
        return {
            "ec2": FakeEC2(self),
            "cloudformation": FakeCloudFormation(self),
            "logs": FakeLogs(self),
            "iam": FakeIAM(self),
            "sts": FakeSts(self),
        }

    def changes(self) -> list[tuple[str, dict]]:
        return [(op, params) for op, params in self.calls if op.startswith(CHANGES)]

    def ops(self) -> list[str]:
        return [op for op, _ in self.changes()]


class _Fake:
    def __init__(self, world: World):
        self.world = world

    def _call(self, op: str, params: dict) -> None:
        self.world.calls.append((op, copy.deepcopy(params)))
        if op in self.world.fail:
            raise self.world.fail[op]


class FakeSts(_Fake):
    def get_caller_identity(self):
        self._call("get_caller_identity", {})
        return {"Account": ACCOUNT, "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/Dev/me"}


class FakeCloudFormation(_Fake):
    def describe_stacks(self, StackName):
        self._call("describe_stacks", {"StackName": StackName})
        stack = self.world.stack
        if stack is None or StackName != STACK:
            raise _error(
                "ValidationError", f"Stack with id {StackName} does not exist", "DescribeStacks"
            )
        return {
            "Stacks": [
                {
                    "StackName": STACK,
                    "StackId": stack["StackId"],
                    "StackStatus": stack["StackStatus"],
                }
            ]
        }

    def list_stack_resources(self, StackName, NextToken=None):
        self._call("list_stack_resources", {"StackName": StackName})
        return _page(self.world.stack["resources"], "StackResourceSummaries", NextToken)


class FakeLogs(_Fake):
    def list_tags_for_resource(self, resourceArn):
        self._call("list_tags_for_resource", {"resourceArn": resourceArn})
        prefix = f"arn:aws:logs:us-east-1:{ACCOUNT}:log-group:"
        assert resourceArn.startswith(prefix), resourceArn
        name = resourceArn[len(prefix) :]
        if name not in self.world.log_groups:
            raise _error(
                "ResourceNotFoundException",
                "The specified log group does not exist.",
                "ListTagsForResource",
            )
        return {"tags": dict(self.world.log_groups[name]["tags"])}

    def delete_log_group(self, logGroupName):
        self._call("delete_log_group", {"logGroupName": logGroupName})
        del self.world.log_groups[logGroupName]


class FakeIAM(_Fake):
    def _role(self, name: str, op: str) -> dict:
        if name not in self.world.roles:
            raise _error("NoSuchEntity", f"The role with name {name} cannot be found.", op)
        return self.world.roles[name]

    def list_role_tags(self, RoleName):
        self._call("list_role_tags", {"RoleName": RoleName})
        tags = self._role(RoleName, "ListRoleTags")["tags"]
        return {"Tags": [{"Key": k, "Value": v} for k, v in tags.items()], "IsTruncated": False}

    def list_role_policies(self, RoleName):
        self._call("list_role_policies", {"RoleName": RoleName})
        return {
            "PolicyNames": list(self._role(RoleName, "ListRolePolicies")["inline"]),
            "IsTruncated": False,
        }

    def delete_role_policy(self, RoleName, PolicyName):
        self._call("delete_role_policy", {"RoleName": RoleName, "PolicyName": PolicyName})
        self._role(RoleName, "DeleteRolePolicy")["inline"].remove(PolicyName)

    def list_attached_role_policies(self, RoleName):
        self._call("list_attached_role_policies", {"RoleName": RoleName})
        arns = self._role(RoleName, "ListAttachedRolePolicies")["attached"]
        policies = [{"PolicyName": a.rsplit("/", 1)[-1], "PolicyArn": a} for a in arns]
        return {"AttachedPolicies": policies, "IsTruncated": False}

    def detach_role_policy(self, RoleName, PolicyArn):
        self._call("detach_role_policy", {"RoleName": RoleName, "PolicyArn": PolicyArn})
        self._role(RoleName, "DetachRolePolicy")["attached"].remove(PolicyArn)

    def delete_role(self, RoleName):
        self._call("delete_role", {"RoleName": RoleName})
        role = self._role(RoleName, "DeleteRole")
        if role["inline"] or role["attached"]:
            raise _error(
                "DeleteConflict", "Cannot delete entity, must delete policies first.", "DeleteRole"
            )
        del self.world.roles[RoleName]


class FakeEC2(_Fake):
    meta = SimpleNamespace(region_name="us-east-1")

    def _depends(self, message: str, op: str) -> ClientError:
        return _error("DependencyViolation", message, op)

    # ------------------------------------------------------------------ describe
    def describe_vpcs(self, Filters=None, NextToken=None):
        self._call("describe_vpcs", {"Filters": Filters})
        found = [v for v in self.world.vpcs.values() if _matches(v, Filters)]
        return _page(found, "Vpcs", NextToken)

    def describe_network_interfaces(
        self, Filters=None, IncludeManagedResources=False, NextToken=None
    ):
        self._call(
            "describe_network_interfaces",
            {"Filters": Filters, "IncludeManagedResources": IncludeManagedResources},
        )
        found = [
            e
            for e in self.world.enis.values()
            if _matches(e, Filters)
            and (IncludeManagedResources or not e.get("Operator", {}).get("Managed"))
        ]
        return _page(found, "NetworkInterfaces", NextToken)

    def describe_nat_gateways(self, Filter=None, NextToken=None):
        self._call("describe_nat_gateways", {"Filter": Filter})
        found = [n for n in self.world.nats.values() if _matches(n, Filter)]
        page = _page(found, "NatGateways", NextToken)
        for nat in found:  # a NAT gateway being deleted is gone by the next look
            if nat["State"] == "deleting":
                nat["State"] = "deleted"
                for address in self.world.addresses.values():
                    if address.get("nat") == nat["NatGatewayId"]:
                        address.pop("AssociationId", None)
        return page

    def describe_vpc_endpoints(self, Filters=None, NextToken=None):
        self._call("describe_vpc_endpoints", {"Filters": Filters})
        found = [e for e in self.world.endpoints.values() if _matches(e, Filters)]
        page = _page(found, "VpcEndpoints", NextToken)
        for endpoint in found:
            if endpoint["State"] == "deleting":
                endpoint["State"] = "deleted"
        return page

    def describe_addresses(self, Filters=None):
        self._call("describe_addresses", {"Filters": Filters})
        found = [a for a in self.world.addresses.values() if _matches(a, Filters)]
        return {
            "Addresses": [{k: v for k, v in a.items() if k != "nat"} for a in copy.deepcopy(found)]
        }

    def describe_flow_logs(self, Filter=None, NextToken=None):
        self._call("describe_flow_logs", {"Filter": Filter})
        found = [f for f in self.world.flow_logs.values() if _matches(f, Filter)]
        return _page(found, "FlowLogs", NextToken)

    def describe_security_groups(self, Filters=None, NextToken=None):
        self._call("describe_security_groups", {"Filters": Filters})
        found = [g for g in self.world.groups.values() if _matches(g, Filters)]
        return _page(found, "SecurityGroups", NextToken)

    def describe_subnets(self, Filters=None, NextToken=None):
        self._call("describe_subnets", {"Filters": Filters})
        found = [s for s in self.world.subnets.values() if _matches(s, Filters)]
        return _page(found, "Subnets", NextToken)

    def describe_route_tables(self, Filters=None, NextToken=None):
        self._call("describe_route_tables", {"Filters": Filters})
        found = [t for t in self.world.route_tables.values() if _matches(t, Filters)]
        return _page(found, "RouteTables", NextToken)

    def describe_internet_gateways(self, Filters=None, NextToken=None):
        self._call("describe_internet_gateways", {"Filters": Filters})
        found = [g for g in self.world.igws.values() if _matches(g, Filters)]
        return _page(found, "InternetGateways", NextToken)

    # ------------------------------------------------------------------ changes
    def delete_nat_gateway(self, NatGatewayId):
        self._call("delete_nat_gateway", {"NatGatewayId": NatGatewayId})
        self.world.nats[NatGatewayId]["State"] = "deleting"
        return {"NatGatewayId": NatGatewayId}

    def delete_vpc_endpoints(self, VpcEndpointIds):
        self._call("delete_vpc_endpoints", {"VpcEndpointIds": VpcEndpointIds})
        for endpoint_id in VpcEndpointIds:
            self.world.endpoints[endpoint_id]["State"] = "deleting"
        return {"Unsuccessful": []}

    def release_address(self, AllocationId):
        self._call("release_address", {"AllocationId": AllocationId})
        if self.world.addresses[AllocationId].get("AssociationId"):
            raise _error("InvalidIPAddress.InUse", "Address is in use.", "ReleaseAddress")
        del self.world.addresses[AllocationId]

    def delete_network_interface(self, NetworkInterfaceId):
        self._call("delete_network_interface", {"NetworkInterfaceId": NetworkInterfaceId})
        eni = self.world.enis.get(NetworkInterfaceId)
        if eni is None:
            raise _error(
                "InvalidNetworkInterfaceID.NotFound", "not found", "DeleteNetworkInterface"
            )
        if eni.get("Operator", {}).get("Managed"):  # an AWS service's own interface
            raise _error(
                "AuthFailure",
                "You do not have permission to access the specified resource.",
                "DeleteNetworkInterface",
            )
        if eni["Status"] != "available":
            raise _error(
                "InvalidParameterValue",
                f"Network interface '{NetworkInterfaceId}' is currently in use.",
                "DeleteNetworkInterface",
            )
        del self.world.enis[NetworkInterfaceId]

    def delete_flow_logs(self, FlowLogIds):
        self._call("delete_flow_logs", {"FlowLogIds": FlowLogIds})
        for flow_log_id in FlowLogIds:
            del self.world.flow_logs[flow_log_id]
        return {"Unsuccessful": []}

    def revoke_security_group_ingress(self, GroupId, IpPermissions):
        self._call(
            "revoke_security_group_ingress", {"GroupId": GroupId, "IpPermissions": IpPermissions}
        )
        self._revoke(GroupId, "IpPermissions", IpPermissions)

    def revoke_security_group_egress(self, GroupId, IpPermissions):
        self._call(
            "revoke_security_group_egress", {"GroupId": GroupId, "IpPermissions": IpPermissions}
        )
        self._revoke(GroupId, "IpPermissionsEgress", IpPermissions)

    def _revoke(self, group_id: str, key: str, permissions: list[dict]) -> None:
        gone = {p["GroupId"] for perm in permissions for p in perm.get("UserIdGroupPairs", [])}
        for rule in self.world.groups[group_id][key]:
            rule["UserIdGroupPairs"] = [
                p for p in rule.get("UserIdGroupPairs", []) if p["GroupId"] not in gone
            ]
        self.world.groups[group_id][key] = [
            r
            for r in self.world.groups[group_id][key]
            if r.get("UserIdGroupPairs") or r.get("IpRanges")
        ]

    def delete_security_group(self, GroupId):
        self._call("delete_security_group", {"GroupId": GroupId})
        group = self.world.groups[GroupId]
        if group["GroupName"] == "default":
            raise _error(
                "CannotDelete",
                'the specified group: "default" name: "default" cannot be deleted by a user',
                "DeleteSecurityGroup",
            )
        used = any(GroupId in {g["GroupId"] for g in e["Groups"]} for e in self.world.enis.values())
        named = any(
            p["GroupId"] == GroupId
            for other in self.world.groups.values()
            for key in ("IpPermissions", "IpPermissionsEgress")
            for rule in other[key]
            for p in rule.get("UserIdGroupPairs", [])
        )
        if used or named:
            raise self._depends(f"resource {GroupId} has a dependent object", "DeleteSecurityGroup")
        del self.world.groups[GroupId]

    def delete_subnet(self, SubnetId):
        self._call("delete_subnet", {"SubnetId": SubnetId})
        if any(e["SubnetId"] == SubnetId for e in self.world.enis.values()):
            raise self._depends(
                f"The subnet '{SubnetId}' has dependencies and cannot be deleted.", "DeleteSubnet"
            )
        del self.world.subnets[SubnetId]
        for table in self.world.route_tables.values():  # its route table association goes with it
            table["Associations"] = [
                a for a in table["Associations"] if a.get("SubnetId") != SubnetId
            ]

    def delete_route_table(self, RouteTableId):
        self._call("delete_route_table", {"RouteTableId": RouteTableId})
        if self.world.route_tables[RouteTableId]["Associations"]:
            raise self._depends(
                f"The routeTable '{RouteTableId}' has dependencies and cannot be deleted.",
                "DeleteRouteTable",
            )
        del self.world.route_tables[RouteTableId]

    def detach_internet_gateway(self, InternetGatewayId, VpcId):
        self._call(
            "detach_internet_gateway", {"InternetGatewayId": InternetGatewayId, "VpcId": VpcId}
        )
        gateway = self.world.igws[InternetGatewayId]
        gateway["Attachments"] = [a for a in gateway["Attachments"] if a["VpcId"] != VpcId]

    def delete_internet_gateway(self, InternetGatewayId):
        self._call("delete_internet_gateway", {"InternetGatewayId": InternetGatewayId})
        if self.world.igws[InternetGatewayId]["Attachments"]:
            raise self._depends(
                f"The internetGateway '{InternetGatewayId}' has dependencies and cannot be deleted.",
                "DeleteInternetGateway",
            )
        del self.world.igws[InternetGatewayId]

    def delete_vpc(self, VpcId):
        self._call("delete_vpc", {"VpcId": VpcId})
        w = self.world
        blocking = (
            [s for s in w.subnets.values() if s["VpcId"] == VpcId]
            + [e for e in w.enis.values() if e["VpcId"] == VpcId]
            + [g for g in w.groups.values() if g["VpcId"] == VpcId and g["GroupName"] != "default"]
            + [
                t
                for t in w.route_tables.values()
                if t["VpcId"] == VpcId and not any(a.get("Main") for a in t["Associations"])
            ]
            + [g for g in w.igws.values() if VpcId in {a["VpcId"] for a in g["Attachments"]}]
            + [n for n in w.nats.values() if n["VpcId"] == VpcId and n["State"] != "deleted"]
            + [e for e in w.endpoints.values() if e["VpcId"] == VpcId and e["State"] != "deleted"]
        )
        if blocking:
            raise self._depends(
                f"The vpc '{VpcId}' has dependencies and cannot be deleted.", "DeleteVpc"
            )
        del w.vpcs[VpcId]
        for store in (w.groups, w.route_tables):  # the default group and the main route table
            for key in [k for k, v in store.items() if v["VpcId"] == VpcId]:
                del store[key]


# ---------------------------------------------------------------------- the account's resources
def _own(stack_id: str) -> list[dict]:
    return [{"Key": "project", "Value": PROJECT}, {"Key": STACK_TAG, "Value": stack_id}]


def network(world: World, vpc_id: str, stack_id: str, *, sweep: bool = False) -> dict:
    """What a stack's network is made of, as R2 keeps it on delete: the VPC, two subnets with a
    route table each (and the main one), the default group, Callers, Endpoints (admitting
    Callers), and a REJECT flow log with its log group and role. ``sweep`` adds what the stack
    deletes itself (a NAT gateway with its address, the S3 gateway endpoint, the internet
    gateway) and a detached Lambda interface. The ids, by name."""
    n = vpc_id.removeprefix("vpc-")
    name = network_cleanup.stack_name(stack_id)
    ids = {
        "vpc": vpc_id,
        "subnets": [f"subnet-{n}-1", f"subnet-{n}-2"],
        "callers": f"sg-{n}-callers",
        "endpoints": f"sg-{n}-endpoints",
        "role": f"{name}-FlowLogsRole-{n}",
        "log_group": f"{name}-FlowLogsGroup-{n}",
    }
    world.vpcs[vpc_id] = {"VpcId": vpc_id, "Tags": _own(stack_id)}
    world.route_tables[f"rtb-{n}-main"] = {
        "RouteTableId": f"rtb-{n}-main",
        "VpcId": vpc_id,
        "Associations": [{"Main": True}],
    }
    for i, subnet in enumerate(ids["subnets"], 1):
        world.subnets[subnet] = {"SubnetId": subnet, "VpcId": vpc_id, "Tags": _own(stack_id)}
        world.route_tables[f"rtb-{n}-{i}"] = {
            "RouteTableId": f"rtb-{n}-{i}",
            "VpcId": vpc_id,
            "Associations": [{"Main": False, "SubnetId": subnet}],
            "Tags": _own(stack_id),
        }
    world.groups[f"sg-{n}-default"] = {
        "GroupId": f"sg-{n}-default",
        "GroupName": "default",
        "VpcId": vpc_id,
        "IpPermissions": [],
        "IpPermissionsEgress": [],
    }
    world.groups[ids["callers"]] = {
        "GroupId": ids["callers"],
        "GroupName": f"{name}-Callers",
        "VpcId": vpc_id,
        "IpPermissions": [],
        "IpPermissionsEgress": [
            {
                "IpProtocol": "tcp",
                "FromPort": 443,
                "ToPort": 443,
                "IpRanges": [{"CidrIp": "0.0.0.0/0"}],
            }
        ],
        "Tags": _own(stack_id),
    }
    world.groups[ids["endpoints"]] = {
        "GroupId": ids["endpoints"],
        "GroupName": f"{name}-Endpoints",
        "VpcId": vpc_id,
        "IpPermissions": [
            {
                "IpProtocol": "tcp",
                "FromPort": 443,
                "ToPort": 443,
                "UserIdGroupPairs": [{"GroupId": ids["callers"], "UserId": ACCOUNT}],
            }
        ],
        "IpPermissionsEgress": [],
        "Tags": _own(stack_id),
    }
    world.flow_logs[f"fl-{n}"] = {
        "FlowLogId": f"fl-{n}",
        "ResourceId": vpc_id,
        "LogGroupName": ids["log_group"],
        "DeliverLogsPermissionArn": f"arn:aws:iam::{ACCOUNT}:role/{ids['role']}",
    }
    tags = {t["Key"]: t["Value"] for t in _own(stack_id)}
    world.roles[ids["role"]] = {
        "tags": dict(tags),
        "inline": ["FlowLogsIAMRoleDefaultPolicy"],
        "attached": [],
    }
    world.log_groups[ids["log_group"]] = {"tags": dict(tags)}
    if sweep:
        world.nats[f"nat-{n}"] = {
            "NatGatewayId": f"nat-{n}",
            "VpcId": vpc_id,
            "State": "available",
            "NatGatewayAddresses": [{"AllocationId": f"eipalloc-{n}"}],
            "Tags": _own(stack_id),
        }
        world.addresses[f"eipalloc-{n}"] = {
            "AllocationId": f"eipalloc-{n}",
            "PublicIp": f"198.51.100.{len(world.addresses) + 1}",
            "AssociationId": f"eipassoc-{n}",
            "nat": f"nat-{n}",
            "Tags": _own(stack_id),
        }
        world.endpoints[f"vpce-{n}"] = {
            "VpcEndpointId": f"vpce-{n}",
            "VpcId": vpc_id,
            "VpcEndpointType": "Gateway",
            "State": "available",
            "Tags": _own(stack_id),
        }
        world.igws[f"igw-{n}"] = {
            "InternetGatewayId": f"igw-{n}",
            "Attachments": [{"VpcId": vpc_id, "State": "available"}],
            "Tags": _own(stack_id),
        }
        interface(world, vpc_id, "lambda", "available", f"eni-{n}-lambda")
    return ids


def interface(
    world: World, vpc_id: str, kind: str, status: str, eni_id: str, *, managed=False
) -> None:
    """A network interface in the VPC's first subnet with Callers. ``managed``: an AWS service's
    own (EC2 lists it only with IncludeManagedResources=True and answers AuthFailure to a
    delete)."""
    n = vpc_id.removeprefix("vpc-")
    world.enis[eni_id] = {
        "NetworkInterfaceId": eni_id,
        "InterfaceType": kind,
        "Status": status,
        "VpcId": vpc_id,
        "SubnetId": f"subnet-{n}-1",
        "Groups": [{"GroupId": f"sg-{n}-callers"}],
        "RequesterManaged": managed,
        **(
            {
                "RequesterId": "AROAEXAMPLE:service",
                "Operator": {"Managed": True, "Principal": "bedrock-agentcore.amazonaws.com"},
            }
            if managed
            else {}
        ),
    }


def agent_interface(world: World, vpc_id: str) -> str:
    """An AgentCore Runtime interface, in use, as the agents leave it for up to 8 hours. The API's
    raw value of the "agentic AI" interface type is not documented; this one is a stand-in."""
    eni_id = f"eni-{vpc_id.removeprefix('vpc-')}-agent"
    interface(world, vpc_id, "agentic_ai", "in-use", eni_id, managed=True)
    return eni_id


def live_stack(world: World, status: str = "UPDATE_COMPLETE") -> dict:
    """The deployed stack with its network in vpc-live (and an agent interface in it). Its
    resource list has more than 100 rows with the VPC last, as DescribeStackResources would cut
    it off."""
    ids = network(world, "vpc-live", LIVE, sweep=True)
    agent_interface(world, "vpc-live")
    rows = [
        {
            "LogicalResourceId": f"Fn{i}",
            "PhysicalResourceId": f"fn-{i}",
            "ResourceType": "AWS::Lambda::Function",
            "ResourceStatus": "UPDATE_COMPLETE",
        }
        for i in range(110)
    ]
    for physical, kind in [
        (ids["role"], "AWS::IAM::Role"),
        (ids["log_group"], "AWS::Logs::LogGroup"),
        (world.addresses["eipalloc-live"]["PublicIp"], "AWS::EC2::EIP"),
        ("vpc-gone", "AWS::EC2::VPC"),  # replaced earlier and kept: DELETE_SKIPPED is not owned
        ("vpc-live", "AWS::EC2::VPC"),
    ]:
        state = "DELETE_SKIPPED" if physical == "vpc-gone" else "CREATE_COMPLETE"
        rows.append(
            {
                "LogicalResourceId": physical,
                "PhysicalResourceId": physical,
                "ResourceType": kind,
                "ResourceStatus": state,
            }
        )
    world.stack = {"StackId": LIVE, "StackStatus": status, "resources": rows}
    return ids


def cleanup(world: World, *, delete: bool, wait_minutes: int = 0, **kw) -> tuple[int, list[str]]:
    lines: list[str] = []
    clients = {"clients": kw.pop("clients")} if "clients" in kw else world.clients()
    code = network_cleanup.run(
        STACK,
        delete=delete,
        wait_minutes=wait_minutes,
        out=lines.append,
        sleep=kw.pop("sleep", world.sleeps.append),
        **clients,
    )
    return code, lines


def _snapshot(world: World, vpc_id: str) -> dict:
    """Everything in the VPC (and its flow log's role and log group), to compare before and after."""
    inside = {
        name: {k: v for k, v in getattr(world, name).items() if v.get("VpcId") == vpc_id}
        for name in ("subnets", "route_tables", "groups", "enis", "nats", "endpoints")
    }
    n = vpc_id.removeprefix("vpc-")
    outside = {
        name: {k: v for k, v in getattr(world, name).items() if n in k}
        for name in ("roles", "log_groups", "addresses", "igws", "flow_logs")
    }
    return copy.deepcopy({**inside, **outside, "vpc": world.vpcs.get(vpc_id)})


# ---------------------------------------------------------------------- which VPCs
def test_the_live_stacks_vpc_is_never_selected_or_touched():
    world = World()
    live_ids = live_stack(world)
    network(world, "vpc-old", OLD)
    before = _snapshot(world, "vpc-live")
    log_groups = dict(world.log_groups)

    code, lines = cleanup(world, delete=True)

    assert code == 0, lines
    assert "the live stack owns vpc-live" in lines
    assert "vpc-old" not in world.vpcs and "vpc-live" in world.vpcs
    assert _snapshot(world, "vpc-live") == before
    assert (
        live_ids["log_group"] in world.log_groups and len(log_groups) == len(world.log_groups) + 1
    )
    # no call names a resource of the live network, and nothing outside vpc-old changed
    assert not [c for c in world.calls if "live" in repr(c[1])], world.calls
    assert all("old" in repr(params) for _, params in world.changes())


def test_a_vpc_a_rolled_back_update_left_is_selected_and_what_it_shares_is_kept():
    """vpc-prev carries the live stack's own id but is not in its resources: an update replaced
    it and rolled back, or completed and kept the old one. Its flow log still points at the role
    and the log group the live stack owns now; those stay."""
    world = World()
    live_ids = live_stack(world)
    network(world, "vpc-prev", LIVE)
    world.flow_logs["fl-prev"].update(
        LogGroupName=live_ids["log_group"],
        DeliverLogsPermissionArn=f"arn:aws:iam::{ACCOUNT}:role/{live_ids['role']}",
    )
    del world.roles[f"{STACK}-FlowLogsRole-prev"], world.log_groups[f"{STACK}-FlowLogsGroup-prev"]
    # an address of the live stack with the same own tag, free for a moment: not vpc-prev's
    world.addresses["eipalloc-spare"] = {
        "AllocationId": "eipalloc-spare",
        "PublicIp": "198.51.100.99",
        "Tags": _own(LIVE),
    }
    world.stack["resources"].append(
        {
            "LogicalResourceId": "NatAddress2",
            "PhysicalResourceId": "198.51.100.99",
            "ResourceType": "AWS::EC2::EIP",
            "ResourceStatus": "CREATE_COMPLETE",
        }
    )

    code, lines = cleanup(world, delete=False)
    assert code == 0 and f"vpc-prev, left by {LIVE}" in lines, lines
    assert "  nothing holds vpc-prev; --delete deletes it" in lines
    assert not any(line.startswith("vpc-live") for line in lines) and world.changes() == []

    code, lines = cleanup(world, delete=True)
    assert code == 0 and "vpc-prev" not in world.vpcs and "vpc-live" in world.vpcs, lines
    assert f"  kept role {live_ids['role']}: the live stack owns it" in lines
    assert f"  kept log group {live_ids['log_group']}: the live stack owns it" in lines
    assert live_ids["role"] in world.roles and live_ids["log_group"] in world.log_groups
    assert "delete_role" not in world.ops() and "delete_log_group" not in world.ops()
    assert "  kept eipalloc-spare: the live stack owns it" in lines
    assert "eipalloc-spare" in world.addresses and "release_address" not in world.ops()


def test_another_stacks_vpc_and_an_untagged_one_are_not_selected():
    world = World()
    network(world, "vpc-other", OTHER)
    network(world, "vpc-bare", OLD)
    world.vpcs["vpc-bare"]["Tags"] = [{"Key": STACK_TAG, "Value": OLD}]  # no project tag
    code, lines = cleanup(world, delete=True)
    assert code == 0 and f"no VPC is left over by {STACK}" in lines, lines
    assert world.changes() == [] and {"vpc-other", "vpc-bare"} <= set(world.vpcs)
    assert "no live stack owns a VPC" in lines


@pytest.mark.parametrize(
    "trouble",
    [
        "AccessDenied",  # any error but "does not exist" from DescribeStacks
        "UPDATE_IN_PROGRESS",  # a stack that is changing
    ],
)
def test_a_stack_that_cannot_be_read_or_is_changing_exits_1_before_any_delete(trouble):
    world = World()
    live_stack(world)
    network(world, "vpc-old", OLD, sweep=True)
    if trouble == "AccessDenied":
        world.fail["describe_stacks"] = _error(
            "AccessDenied",
            "User: me is not authorized to perform: cloudformation:DescribeStacks",
            "DescribeStacks",
        )
    else:
        world.stack["StackStatus"] = trouble
    code, lines = cleanup(world, delete=True)
    assert code == 1 and world.changes() == [], lines
    assert trouble in lines[-1] and lines[0].startswith(f"account {ACCOUNT} · us-east-1")


# ---------------------------------------------------------------------- what holds a VPC
def test_report_mode_makes_no_delete_call_and_exits_3_while_interfaces_are_held():
    world = World()
    network(world, "vpc-old", OLD, sweep=True)  # also a detached Lambda interface
    agent_interface(world, "vpc-old")
    for i in range(3):  # enough interfaces to need a second page
        interface(world, "vpc-old", "lambda", "in-use", f"eni-old-busy-{i}")

    code, lines = cleanup(world, delete=False)

    assert code == 3 and world.changes() == [], lines
    assert (
        lines[0]
        == f"account {ACCOUNT} · us-east-1 · stack {STACK} · report only (add --delete to delete)"
    )
    assert f"vpc-old, left by {OLD}" in lines and "  network interfaces: 5" in lines
    assert "    1 x agentic_ai, in-use, requester AROAEXAMPLE:service: eni-old-agent" in lines
    assert "    1 x lambda, available, requester none: eni-old-lambda" in lines
    assert (
        "    3 x lambda, in-use, requester none: eni-old-busy-0, eni-old-busy-1, eni-old-busy-2"
        in lines
    )
    assert any("up to 8 hours after the stack's delete" in line for line in lines)
    assert any(
        "3 Lambda interface(s): Lambda deletes them up to 20 minutes" in line for line in lines
    )
    assert lines[-1] == "VPCs in us-east-1: 1; the default quota is 5, the default VPC included"
    listed = [p for op, p in world.calls if op == "describe_network_interfaces"]
    assert listed and all(p["IncludeManagedResources"] is True for p in listed)


def test_an_agentcore_interface_in_use_stops_the_vpc_with_exit_3_and_the_8_hour_message():
    world = World()
    network(world, "vpc-old", OLD)
    agent_interface(world, "vpc-old")
    # the fake hides it from a call that does not ask for managed resources, as EC2 does
    hidden = FakeEC2(world).describe_network_interfaces(
        Filters=[{"Name": "vpc-id", "Values": ["vpc-old"]}]
    )
    assert hidden["NetworkInterfaces"] == []

    code, lines = cleanup(world, delete=True)

    assert code == 3, lines
    assert (
        "  1 AgentCore Runtime interface(s): AgentCore removes them up to 8 hours after the stack's delete"
        in lines
    )
    assert "  vpc-old stays until they are gone; run again later or add --wait MINUTES" in lines
    assert world.changes() == []  # no flow log, role, log group, group, subnet or VPC delete
    assert "vpc-old" in world.vpcs and world.flow_logs and world.roles and world.log_groups


def test_an_available_interface_of_another_type_is_not_deleted():
    world = World()
    network(world, "vpc-old", OLD)
    interface(world, "vpc-old", "interface", "available", "eni-old-mine")
    code, lines = cleanup(world, delete=True)
    assert code == 3 and "delete_network_interface" not in world.ops(), lines
    assert "eni-old-mine" in world.enis
    assert (
        "  1 interface(s) of type interface, created in the account: delete them or what uses them"
        in lines
    )


def test_authfailure_on_a_delete_counts_as_held():
    world = World()
    network(world, "vpc-old", OLD)
    interface(world, "vpc-old", "lambda", "available", "eni-old-owned", managed=True)
    code, lines = cleanup(world, delete=True)
    assert code == 3, lines
    assert world.ops() == ["delete_network_interface"] and "eni-old-owned" in world.enis
    assert any(line.startswith("  held: AuthFailure") for line in lines)


def test_detached_lambda_interfaces_are_deleted():
    world = World()
    network(world, "vpc-old", OLD)
    interface(world, "vpc-old", "lambda", "available", "eni-old-left")
    code, lines = cleanup(world, delete=True)
    assert code == 0 and "eni-old-left" not in world.enis and "vpc-old" not in world.vpcs, lines
    assert ("delete_network_interface", {"NetworkInterfaceId": "eni-old-left"}) in world.changes()


# ---------------------------------------------------------------------- the deletes
def test_with_nothing_held_the_deletes_run_in_order_and_the_vpc_is_gone():
    world = World()
    ids = network(world, "vpc-old", OLD, sweep=True)

    code, lines = cleanup(world, delete=True)

    assert code == 0 and "  deleted vpc-old" in lines, lines
    assert world.ops() == [
        "delete_nat_gateway",  # 1. NAT gateways and endpoints, until gone; free addresses
        "delete_vpc_endpoints",
        "release_address",
        "delete_network_interface",  # 2. the detached Lambda interface
        "delete_flow_logs",  # 3. flow log, its role (policies first), its log group
        "delete_role_policy",
        "delete_role",
        "delete_log_group",
        "revoke_security_group_ingress",  # 4. Endpoints' rule naming Callers, then both groups
        "delete_security_group",
        "delete_security_group",
        "delete_subnet",  # 5.
        "delete_subnet",
        "delete_route_table",  # 6. not the main one
        "delete_route_table",
        "detach_internet_gateway",  # 7.
        "delete_internet_gateway",
        "delete_vpc",  # 8.
    ]
    assert world.sleeps == [15]  # one wait while the NAT gateway and the endpoint were deleting
    assert "vpc-old" not in world.vpcs
    assert not world.subnets and not world.groups and not world.route_tables and not world.igws
    assert not world.enis and not world.flow_logs and not world.roles and not world.log_groups
    assert not world.addresses
    # every change is printed before it is made
    for op, params in world.changes():
        printed = f"  {'iam' if 'role' in op else 'logs' if 'log_group' in op else 'ec2'}.{op}("
        assert any(line.startswith(printed) for line in lines), op
    revoke = world.changes()[8][1]
    assert revoke["GroupId"] == ids["endpoints"]
    assert revoke["IpPermissions"] == [
        {
            "IpProtocol": "tcp",
            "FromPort": 443,
            "ToPort": 443,
            "UserIdGroupPairs": [{"GroupId": ids["callers"]}],
        }
    ]
    assert lines[-1] == "VPCs in us-east-1: 0; the default quota is 5, the default VPC included"


def test_log_groups_the_flow_log_does_not_name_or_without_the_own_tag_are_never_deleted():
    world = World()
    ids = network(world, "vpc-old", OLD)
    world.log_groups[ids["log_group"]]["tags"] = {"project": PROJECT}  # no own tag
    world.log_groups[f"/aws/lambda/{STACK}-ApiFunction"] = {"tags": {STACK_TAG: OLD}}  # not named
    code, lines = cleanup(world, delete=True)
    assert code == 0 and "vpc-old" not in world.vpcs, lines
    assert "delete_log_group" not in world.ops()
    assert {ids["log_group"], f"/aws/lambda/{STACK}-ApiFunction"} == set(world.log_groups)
    assert f"  kept log group {ids['log_group']}: its {STACK_TAG} tag is not {OLD}" in lines


def test_a_flow_log_role_with_another_stacks_tag_is_kept():
    world = World()
    ids = network(world, "vpc-old", OLD)
    world.roles[ids["role"]]["tags"][STACK_TAG] = OTHER
    code, lines = cleanup(world, delete=True)
    assert code == 0 and "vpc-old" not in world.vpcs, lines
    assert ids["role"] in world.roles and not {"delete_role", "delete_role_policy"} & set(
        world.ops()
    )
    assert f"  kept role {ids['role']}: its {STACK_TAG} tag is not {OLD}" in lines


def test_an_internet_gateway_without_the_own_tag_stays_and_the_vpc_delete_names_the_vpc():
    world = World()
    network(world, "vpc-old", OLD, sweep=True)
    world.igws["igw-old"]["Tags"] = []
    code, lines = cleanup(world, delete=True)
    assert code == 1 and "detach_internet_gateway" not in world.ops(), lines
    assert world.ops()[-1] == "delete_vpc" and "vpc-old" in world.vpcs
    assert any(line.startswith("  stopped: vpc-old still has a dependency") for line in lines)


def test_with_two_vpcs_the_worst_code_wins():
    world = World()
    network(world, "vpc-a", OLD)  # free: deleted (0)
    network(world, "vpc-b", OLD)
    agent_interface(world, "vpc-b")  # held (3)
    code, lines = cleanup(world, delete=True)
    assert code == 3 and "vpc-a" not in world.vpcs and "vpc-b" in world.vpcs, lines

    network(
        world, "vpc-c", OLD
    )  # a route table with a gateway association: kept, the VPC fails (1)
    world.route_tables["rtb-c-gw"] = {
        "RouteTableId": "rtb-c-gw",
        "VpcId": "vpc-c",
        "Associations": [{"Main": False, "GatewayId": "vgw-c"}],
    }
    code, lines = cleanup(world, delete=True)
    assert code == 1, lines
    assert "  kept rtb-c-gw: associated with vgw-c" in lines and "rtb-c-gw" in world.route_tables
    assert any(
        line.startswith("  stopped: vpc-c still has a dependency: DependencyViolation")
        for line in lines
    )


# ---------------------------------------------------------------------- --wait and credentials
def test_wait_polls_with_a_new_client_set_each_time_and_gives_up_after_its_minutes():
    world = World()
    network(world, "vpc-old", OLD)
    agent_interface(world, "vpc-old")
    made: list[dict] = []

    def clients():
        made.append(world.clients())
        return made[-1]

    code, lines = cleanup(world, delete=True, wait_minutes=12, clients=clients)

    assert code == 3 and world.sleeps == [300, 300], lines  # looks at 0, 5 and 10 minutes
    assert len(made) == 3 and len({id(c["ec2"]) for c in made}) == 3
    assert lines[-1] == "still held after 10 minutes; run again later"
    assert world.changes() == []


def test_wait_ends_once_agentcore_has_removed_its_interfaces():
    world = World()
    network(world, "vpc-old", OLD)
    agent = agent_interface(world, "vpc-old")

    def sleep(seconds):
        world.sleeps.append(seconds)
        del world.enis[agent]  # AgentCore lets go during the first wait

    code, lines = cleanup(world, delete=True, wait_minutes=540, sleep=sleep)
    assert code == 0 and world.sleeps == [300] and "vpc-old" not in world.vpcs, lines


@pytest.mark.parametrize("how", ["session token", "SSO session"])
def test_expired_credentials_exit_1_with_their_message(how):
    world = World()
    network(world, "vpc-old", OLD)
    agent_interface(world, "vpc-old")
    looks = []

    def clients():
        looks.append(1)
        if len(looks) == 2 and how == "SSO session":
            raise UnauthorizedSSOTokenError()
        return world.clients()

    def sleep(seconds):
        if how == "session token":
            world.fail["get_caller_identity"] = _error(
                "ExpiredToken",
                "The security token included in the request is expired",
                "GetCallerIdentity",
            )

    code, lines = cleanup(world, delete=True, wait_minutes=60, clients=clients, sleep=sleep)
    assert code == 1 and lines[-1] == "credentials expired; run again" and len(looks) == 2, lines


def test_the_cli_passes_the_options_and_a_client_factory_and_returns_the_code(
    monkeypatch, tmp_path, capsys
):
    monkeypatch.setenv("AWS_REGION", "eu-central-1")
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    seen = {}

    def run(stack, **kw):
        seen.update(stack=stack, **kw)
        return 3

    monkeypatch.setattr(network_cleanup, "run", run)
    assert cli.main(["network-cleanup", "--stack", "Mine", "--delete", "--wait", "540"]) == 3
    assert seen["stack"] == "Mine" and seen["delete"] is True and seen["wait_minutes"] == 540
    factory = seen["clients"]
    assert isinstance(factory, functools.partial) and factory.func is network_cleanup.new_clients
    assert factory.args == ("eu-central-1",)

    assert cli.main(["network-cleanup"]) == 3
    assert seen["stack"] == STACK and seen["delete"] is False and seen["wait_minutes"] == 0

    def denied(stack, **kw):
        raise _error("AccessDenied", "not authorized", "DescribeVpcs")

    monkeypatch.setattr(network_cleanup, "run", denied)
    assert cli.main(["network-cleanup"]) == 1
    assert (
        "(AccessDenied) when calling the DescribeVpcs operation: not authorized"
        in capsys.readouterr().err
    )

    with pytest.raises(SystemExit) as stop:
        cli.main(["network-cleanup", "--wait", "30"])
    assert stop.value.code == 2 and "--wait needs --delete" in capsys.readouterr().err


def test_new_clients_builds_the_five_from_a_new_session_each_time(monkeypatch, tmp_path):
    """Offline: building a client reads the bundled service models, no credentials, no call."""
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    first, second = (
        network_cleanup.new_clients("eu-central-1"),
        network_cleanup.new_clients("eu-central-1"),
    )
    assert set(first) == {"ec2", "cloudformation", "logs", "iam", "sts"}
    assert {c.meta.region_name for k, c in first.items() if k != "iam"} == {"eu-central-1"}
    assert first["ec2"] is not second["ec2"]
