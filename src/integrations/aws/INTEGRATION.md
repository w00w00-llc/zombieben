# Setup AWS

Connect ZombieBen to AWS for workflow steps that need basic deployment or asset
publishing access.

This integration supports workflow tooling only. It does not provide triggers or
notification responders.

## Required settings

Configure AWS integration in `~/.zombieben/keys.json` with:

- `access_key_id`
- `secret_access_key`
- `region`
- `cloudfront_distribution_url`
- `bucket_name`

Example:

```json
{
  "aws": {
    "access_key_id": "AKIA...",
    "secret_access_key": "replace-me",
    "region": "us-east-1",
    "cloudfront_distribution_url": "https://d111111abcdef8.cloudfront.net",
    "bucket_name": "my-assets-bucket"
  }
}
```

Use the `setIntegrationKeys` helper if you want to write keys programmatically:

```ts
setIntegrationKeys("aws", {
  access_key_id: "<access-key-id>",
  secret_access_key: "<secret-access-key>",
  region: "<aws-region>",
  cloudfront_distribution_url: "<cloudfront-distribution-url>",
  bucket_name: "<bucket-name>",
});
```

## Workflow environment

Workflows with `required_integrations: { aws: {} }` receive these environment
variables automatically:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `AWS_CLOUDFRONT_DISTRIBUTION_URL`
- `AWS_BUCKET_NAME`

No `integrations.json` entry is required for this basic setup.
