# The Big Give Content API

This is a Node.js project currently containing a single function for AWS Lambda in `index.js`,
which provides the `POST` endpoint for the Big Give's user-generated content API.

## Install packages and build Sharp for Lambda

* `npm install`
* Follow [instructions for Sharp on Lambda](https://sharp.pixelplumbing.com/en/stable/install/#aws-lambda) (Docker approach on Linux).

## Upload Lambda package manually

* Zip up the *contents* of the folder (not the whole folder), including `node_modules/`.
* Upload [here](https://eu-west-2.console.aws.amazon.com/lambda/home?region=eu-west-2#/functions/content-api-post-sandbox?tab=graph).
