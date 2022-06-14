# The Big Give Content API

This is a Node.js project currently containing a single function for AWS Lambda in `content-api-post.js`,
which provides the `POST` endpoint for the Big Give's user-generated content API.

## Install packages and build Sharp for Lambda

As per [instructions for Sharp on Lambda](https://sharp.pixelplumbing.com/en/stable/install/#aws-lambda):

* `npm install`
* `rm -rf node_modules/sharp`
* `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --arch=x64 --platform=linux --libc=glibc sharp`

## Upload Lambda package manually

* Zip up the *contents* of the folder (not the whole folder), including `node_modules/`. This
  need not include normally-hidden files like `.git*` metadata.
* Upload [here](https://eu-west-1.console.aws.amazon.com/lambda/home?region=eu-west-1#/functions/tbg-staging-content-api-post).
