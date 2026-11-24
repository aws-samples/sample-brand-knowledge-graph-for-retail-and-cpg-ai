# Security

## Reporting a vulnerability

If you discover a potential security issue in this project, notify AWS/Amazon Security through the
[vulnerability reporting page](https://aws.amazon.com/security/vulnerability-reporting/). Please do
not create a public GitHub issue. See also
[CONTRIBUTING.md](CONTRIBUTING.md#security-issue-notifications).

## What the sample protects, and what it leaves to you

> [!IMPORTANT]
> This is sample code, for non-production usage.

[docs/security.md](docs/security.md) describes the trust boundaries of the deployed stack: the
sign-in, IAM at the API's function URL, the per-function roles, the private
network, the limits on every request, the agents' read-only guards and the parsers. It also lists
the residual risks accepted for a demo, each with what to change before the site serves more than
one trusted user.
