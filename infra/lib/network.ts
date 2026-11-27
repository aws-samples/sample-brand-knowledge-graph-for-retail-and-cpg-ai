// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct, DependencyGroup, IConstruct } from 'constructs';

/**
 * The stack's own VPC: the graph is private (publicConnectivity false), and everything that calls
 * it, the API, pipeline and loader functions and both AgentCore Runtime agents, runs in two private
 * subnets and reaches it through a private graph endpoint. The other AWS APIs (Bedrock, AgentCore,
 * Neptune Analytics' control API, CloudWatch Logs, S3 Tables, S3 Vectors, Step Functions, Lambda,
 * SSM) and the user pool's signing keys go through one regional NAT gateway; S3 goes through a
 * gateway endpoint. The only public IP addresses are the NAT gateway's two Elastic IPs, and no
 * security group admits traffic from outside the VPC.
 */

/**
 * The AZ IDs AgentCore Runtime accepts for an agent's subnets in VPC mode, by Region: "Supported
 * Availability Zones" of https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-vpc.html
 * (read 9 Nov 2026). The stack takes the first two of its Region unless `-c vpcAzIds=` names two.
 */
export const AGENTCORE_AZ_IDS: Record<string, string[]> = {
  'us-east-1': ['use1-az1', 'use1-az2', 'use1-az4'],
  'us-east-2': ['use2-az1', 'use2-az2', 'use2-az3'],
  'us-west-1': ['usw1-az1', 'usw1-az3'],
  'us-west-2': ['usw2-az1', 'usw2-az2', 'usw2-az3'],
  'ap-southeast-5': ['apse5-az1', 'apse5-az2', 'apse5-az3'],
  'ap-south-1': ['aps1-az1', 'aps1-az2', 'aps1-az3'],
  'ap-south-2': ['aps2-az1', 'aps2-az2', 'aps2-az3'],
  'ap-northeast-2': ['apne2-az1', 'apne2-az2', 'apne2-az3'],
  'ap-southeast-1': ['apse1-az1', 'apse1-az2', 'apse1-az3'],
  'ap-southeast-2': ['apse2-az1', 'apse2-az2', 'apse2-az3'],
  'ap-southeast-7': ['apse7-az1', 'apse7-az2', 'apse7-az3'],
  'ap-northeast-1': ['apne1-az1', 'apne1-az2', 'apne1-az4'],
  'ca-central-1': ['cac1-az1', 'cac1-az2', 'cac1-az4'],
  'eu-central-1': ['euc1-az1', 'euc1-az2', 'euc1-az3'],
  'eu-west-1': ['euw1-az1', 'euw1-az2', 'euw1-az3'],
  'eu-west-2': ['euw2-az1', 'euw2-az2', 'euw2-az3'],
  'eu-south-1': ['eus1-az1', 'eus1-az2', 'eus1-az3'],
  'eu-west-3': ['euw3-az1', 'euw3-az2', 'euw3-az3'],
  'eu-south-2': ['eus2-az1', 'eus2-az2', 'eus2-az3'],
  'eu-north-1': ['eun1-az1', 'eun1-az2', 'eun1-az3'],
  'sa-east-1': ['sae1-az1', 'sae1-az2', 'sae1-az3'],
  'us-gov-west-1': ['usgw1-az1', 'usgw1-az2', 'usgw1-az3'],
};

/** An AZ ID as EC2 names it: the Region's short code, `-az`, a number (`use1-az1`). */
const AZ_ID = /^[a-z0-9]+-az[0-9]+$/;

/** Two different AZ IDs, or an Error naming `vpcAzIds` (the context key that sets them). */
export function checkAzIds(ids: string[]): string[] {
  if (ids.length !== 2 || new Set(ids).size !== 2 || !ids.every((id) => AZ_ID.test(id))) {
    throw new Error(`vpcAzIds must be two different AZ IDs, for example -c vpcAzIds=use1-az1,use1-az2; got "${ids.join(',')}"`);
  }
  return ids;
}

/**
 * The two AZ IDs of the VPC's private subnets: `override` (`-c vpcAzIds=`) when given, else the first
 * two AgentCore supports in the Region. An AZ name can map to a different zone in each account, an
 * AZ ID names the same zone in every account, so the subnets are placed by ID. A Region missing from
 * AGENTCORE_AZ_IDS, or a stack without a Region, needs the override: nothing is looked up at synth.
 */
export function resolveAzIds(region: string, override?: string[]): string[] {
  if (override) return checkAzIds(override);
  if (cdk.Token.isUnresolved(region)) {
    throw new Error('the stack has no Region to choose its two AZ IDs from: bind it to a Region (env), or name the IDs with -c vpcAzIds=<id>,<id>');
  }
  const supported = AGENTCORE_AZ_IDS[region];
  if (!supported) {
    throw new Error(`no AgentCore AZ IDs are listed for ${region} (AGENTCORE_AZ_IDS, network.ts): name two with -c vpcAzIds=<id>,<id>`);
  }
  return supported.slice(0, 2);
}

/** The own tag: the stack's id on every taggable resource of the network, what `ontology-rag network-cleanup` finds a retained VPC by. */
const STACK_ID_TAG = 'multimodal-ai-knowledge-graph:stack-id';

export interface NetworkProps {
  /**
   * The two AZ IDs (resolveAzIds). The stack returns the same two as its `availabilityZones`, which
   * is where `ec2.Vpc` places its subnets (multimodal-ai-knowledge-graph-stack.ts).
   */
  readonly azIds: string[];
}

/**
 * The VPC, its egress, its flow log and the two security groups the graph's callers and its private
 * endpoint use. Fixed at the first deploy: the AZ IDs and the CIDR place the subnets, and AgentCore
 * holds its interfaces in them for up to 8 hours after the agents are deleted, so a change means a
 * destroy, then a deploy.
 */
export class Network extends Construct {
  readonly vpc: ec2.Vpc;
  readonly privateSubnets: ec2.ISubnet[];
  /** The functions and agents: no inbound, HTTPS out only. */
  readonly callers: ec2.SecurityGroup;
  /** The private graph endpoint: HTTPS in from `callers` only. */
  readonly endpoints: ec2.SecurityGroup;
  /**
   * The S3 gateway endpoint, the internet gateway's attachment and the private subnets' routes to
   * the NAT gateway: what a resource that needs egress while it is being created waits for (the
   * agents fetch their code zips, the loader calls Bedrock).
   */
  readonly egressReady: DependencyGroup;
  readonly azIds: string[];

  constructor(scope: Construct, id: string, props: NetworkProps) {
    super(scope, id);
    this.azIds = props.azIds;

    // The regional NAT gateway in manual mode: one Elastic IP per AZ ID, so it serves both subnets
    // from the moment it exists. In automatic mode it expands to an AZ only after it sees a network
    // interface there, and the loader needs egress minutes after the VPC is created.
    const natAddresses = props.azIds.map((_azId, i) => new ec2.CfnEIP(this, `NatAddress${i + 1}`, { domain: 'vpc' }));
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2, // the stack's two AZ IDs
      // Private subnets only: the regional NAT gateway needs no public subnet.
      subnetConfiguration: [{ name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 20 }],
      natGatewayProvider: ec2.NatProvider.regionalGateway({
        availabilityZoneAddresses: props.azIds.map((azId, i) => ({ availabilityZoneId: azId, allocationIds: [natAddresses[i].attrAllocationId] })),
      }),
      // No rule in the VPC's default security group (Security Hub EC2.2); nothing uses it.
      restrictDefaultSecurityGroup: true,
      // S3 without the NAT gateway: the agents' code zips, the data bucket, S3 Tables' data files and
      // the loader's CloudFormation response URL. The default (full) policy: the bucket policies are
      // the boundary, and S3 Tables' storage buckets cannot be named in advance.
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });
    this.privateSubnets = this.vpc.privateSubnets;

    // ec2.Vpc puts the stack's availabilityZones, here the AZ IDs, into each subnet's
    // AvailabilityZone: CloudFormation takes them as AvailabilityZoneId instead.
    for (const subnet of this.vpc.privateSubnets) {
      const cfnSubnet = subnet.node.findChild('Subnet') as ec2.CfnSubnet;
      cfnSubnet.addPropertyOverride('AvailabilityZoneId', subnet.availabilityZone);
      cfnSubnet.addPropertyDeletionOverride('AvailabilityZone');
    }

    // aws-cdk-lib wires the internet gateway's attachment (VPCGW) only into public subnets' routes,
    // and this VPC has none: the regional NAT gateway would depend on the gateway alone. A public NAT
    // gateway needs the gateway attached, and an Elastic IP for a VPC of the same template must
    // depend on the attachment (CloudFormation's AWS::EC2::EIP reference).
    const attachment = this.vpc.node.findChild('VPCGW') as ec2.CfnVPCGatewayAttachment;
    this.vpc.node.findChild('RegionalNatGateway').node.addDependency(attachment);
    natAddresses.forEach((address) => address.node.addDependency(attachment));

    // Rejected traffic only (Security Hub EC2.6 asks for REJECT at least), 30 days, in a group the
    // stack creates without a name, so a group retained by an earlier stack never collides.
    const flowLogsGroup = new logs.LogGroup(this, 'FlowLogsGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const flowLog = new ec2.FlowLog(this, 'FlowLogs', {
      resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
      trafficType: ec2.FlowLogTrafficType.REJECT,
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogsGroup),
    });

    // Every call the code makes is HTTPS; DNS goes to the VPC resolver, which security groups do not
    // filter. The lake agent shares the group: its role has no graph permission, so IAM, not the
    // network, keeps it off the graph. EC2 allows only letters, digits, spaces and a few punctuation
    // marks in group and rule descriptions (no apostrophes).
    this.callers = new ec2.SecurityGroup(this, 'Callers', {
      vpc: this.vpc,
      description: 'multimodal-ai-knowledge-graph functions and agents: no inbound, HTTPS outbound only',
      allowAllOutbound: false,
    });
    this.callers.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS to the private graph endpoint, S3 and the AWS APIs');
    this.endpoints = new ec2.SecurityGroup(this, 'Endpoints', {
      vpc: this.vpc,
      description: 'multimodal-ai-knowledge-graph private graph endpoint: HTTPS from the callers group only',
      allowAllOutbound: false,
    });
    this.endpoints.addIngressRule(this.callers, ec2.Port.tcp(443), 'HTTPS from the functions and agents');

    this.egressReady = new DependencyGroup(
      this.vpc.node.findChild('S3'),
      attachment,
      ...this.vpc.privateSubnets.map((subnet) => subnet.internetConnectivityEstablished),
    );

    cdk.Tags.of(this).add(STACK_ID_TAG, cdk.Aws.STACK_ID);
    this.retainOnDelete(flowLog);
  }

  /**
   * What a stack delete (or the rollback of a failed first create) keeps. AgentCore keeps the
   * agents' network interfaces in the subnets for up to 8 hours after the runtimes are deleted, and
   * nobody can delete them sooner, so CloudFormation could not delete the subnets, the security
   * groups or the VPC. Kept instead, at no hourly cost: the VPC, the subnets and their route tables,
   * both groups, the flow log with its role and group (the VPC stays logged), and the default group's
   * custom resource, whose Delete would re-open the default group. Everything billed per hour goes
   * with the stack: the NAT gateway and its addresses, the internet gateway, the routes, the
   * endpoints. Plain RETAIN, so a failed first create still ends in ROLLBACK_COMPLETE. The rest is
   * for `make network-cleanup` once AgentCore has released the interfaces.
   */
  private retainOnDelete(flowLog: ec2.FlowLog): void {
    const retain = (resource: IConstruct) => (resource as cdk.CfnResource).applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    retain(this.vpc.node.findChild('Resource'));
    for (const subnet of this.vpc.privateSubnets) {
      retain(subnet.node.findChild('Subnet'));
      retain(subnet.node.findChild('RouteTable'));
    }
    retain(this.callers.node.defaultChild!);
    retain(this.endpoints.node.defaultChild!);
    // The FlowLog construct itself refuses applyRemovalPolicy; its children take it.
    retain(flowLog.node.findChild('FlowLog'));
    const role = flowLog.node.findChild('IAMRole');
    retain(role.node.defaultChild!);
    retain(role.node.findChild('DefaultPolicy').node.defaultChild!);
    retain(this.vpc.node.findChild('RestrictDefaultSecurityGroupCustomResource').node.defaultChild!);
  }
}
