<div align="center">

<img src="public/logo.svg" alt="tenant" width="440" />

Passive Microsoft 365 domain and user reconnaissance, in the browser.
</div>

---

## Overview

**tenant** checks whether a domain is registered with Microsoft 365 and whether a specific user account exists — using Microsoft's public pre-authentication endpoints. The checks are passive: they make no login attempts, generate no sign-in events, and raise no alerts. It runs as a small web app with a console-style interface and a light or dark theme.

## Features

- **Domain validation** — namespace type (Managed, Federated, or Unknown), tenant ID, and federation brand
- **User enumeration** — whether an email maps to a valid Microsoft 365 login identity
- **Desktop SSO detection** — flags tenants with Desktop Single Sign-On enabled
- **Automation API** — a JSON endpoint for scripting and pipelines
- Light and dark theme, responsive layout, keyboard accessible

## How it works

Two unauthenticated Microsoft endpoints sit in the pre-authentication login flow.

Domain validation uses the `getuserrealm.srf` endpoint. Its `NameSpaceType` field reveals whether a domain is a standard Microsoft 365 tenant (`Managed`), uses federated authentication (`Federated`), or is not registered (`Unknown`).

User enumeration uses the `GetCredentialType` endpoint. Its `IfExistsResult` field indicates whether a user principal name exists (`0`, `5`, or `6`) or not (`1`).

Both endpoints are public, require no credentials, and do not appear in sign-in audit logs. Because they resolve User Principal Names, a valid email may return "not found" if it is only an alias rather than the primary login identity.

## Automation

The interface is backed by a JSON API. Send a `POST` to `/api/check`:

```json
{ "mode": "domain", "target": "contoso.com" }
```

A domain response:

```json
{
  "success": true,
  "mode": "domain",
  "domain": "contoso.com",
  "exists": true,
  "namespace_type": "Managed",
  "tenant_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

A user response (`mode` of `user`, with an email as the target):

```json
{
  "success": true,
  "mode": "user",
  "email": "john.doe@contoso.com",
  "valid": true,
  "if_exists_result": 0,
  "desktop_sso": false
}
```

Errors return `{ "success": false, "error": "..." }`.

## Notes

- Results reflect login identities (User Principal Names), not email aliases.
- Every check is passive and uses only public Microsoft endpoints.
- Use it only against domains and accounts you are authorized to assess.
