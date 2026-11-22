# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

"""``ontology-rag`` command line: the developer and deploy-time tools that need no graph.

ontology-rag synth                 # regenerate ontologies/fashion/datasets/anycompany-apparel from synth.py
ontology-rag check-models          # pre-flight: one tiny request per Bedrock model the sample uses
ontology-rag network-cleanup [--stack NAME] [--delete] [--wait MINUTES]  # after `cdk destroy`: the VPC the stack kept

Each subcommand is one function below, registered with ``set_defaults(run=...)``; ``main`` parses
the arguments and calls it with the settings.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import partial

from botocore.exceptions import ClientError

from ontology_rag import network_cleanup, service, setup, synth
from ontology_rag.config import DEFAULT_DOMAIN, load_settings
from ontology_rag.errors import NotReady
from ontology_rag.ontologies import DATASETS_DIR
from ontology_rag.ontology import load_ontology


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="ontology-rag",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser(
        "synth", help="regenerate the AnyCompany Apparel data set (datasets/anycompany-apparel)"
    ).set_defaults(run=cmd_synth)
    cleanup = (
        "after `cdk destroy`: report the VPC the stack kept and what still holds it; with "
        "--delete, delete it once AgentCore has released the agents' network interfaces (up to "
        "8 hours). Exit 0 nothing held, 3 interfaces held, 1 an error"
    )
    nc = sub.add_parser("network-cleanup", help=cleanup, description=cleanup)
    nc.add_argument(
        "--stack",
        metavar="NAME",
        default=network_cleanup.DEFAULT_STACK,
        help=f"the stack whose VPCs to look for (default: {network_cleanup.DEFAULT_STACK})",
    )
    nc.add_argument("--delete", action="store_true", help="delete the leftover VPCs")
    nc.add_argument(
        "--wait",
        type=int,
        metavar="MINUTES",
        help="with --delete: while interfaces are held, look again every 5 minutes for up to "
        "MINUTES",
    )
    nc.set_defaults(run=cmd_network_cleanup)
    sub.add_parser(
        "check-models",
        help="pre-flight before `cdk deploy`: send every Bedrock model the sample uses one tiny "
        "request and report which the account may call",
    ).set_defaults(run=cmd_check_models)

    args = p.parse_args(argv)
    if args.cmd == "network-cleanup" and args.wait is not None:
        if not args.delete:
            nc.error("--wait needs --delete")
        if args.wait < 1:
            nc.error("--wait needs a number of minutes above 0")
    try:
        return args.run(args, load_settings())
    except (NotReady, RuntimeError) as exc:  # a step not taken yet, a resource that is not there
        print(str(exc), file=sys.stderr)
        return 1


def _print(obj) -> int:
    print(json.dumps(obj, indent=2))
    return 0


def cmd_synth(args, settings) -> int:
    out = settings.ontologies_dir / DEFAULT_DOMAIN / DATASETS_DIR / synth.SET_ID
    return _print(synth.write_catalog(load_ontology(settings.ontology_path), out))


def cmd_network_cleanup(args, settings) -> int:
    """The VPC a deleted stack kept (network_cleanup.py) in ``settings.region``, with a new
    session for every look; the exit code is the command's (0, 3 or 1)."""
    try:
        return network_cleanup.run(
            args.stack,
            delete=args.delete,
            wait_minutes=args.wait or 0,
            clients=partial(network_cleanup.new_clients, settings.region),
        )
    except ClientError as exc:  # the call and AWS's message, not a traceback
        print(str(exc), file=sys.stderr)
        return 1


def cmd_check_models(args, settings) -> int:
    """One line per model: id, ok or the error. Exit 1 when any model is denied, so the check can
    gate a deploy script."""
    out = setup.check_models(service.Service(settings))
    for row in out["models"]:
        verdict = "ok" if row["ok"] else f"error: {row['error']}"
        print(f"{row['id']}  {verdict}")
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
