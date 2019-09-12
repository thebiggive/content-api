'use strict'

var AWS = require('aws-sdk');
const fileType = require('file-type');
const uuidv4 = require('uuid/v4');

const s3 = new AWS.S3();

function fail(message, code, callback) {
  if (code == 500) {
    callback(new Error(message));
    return;
  }

  callback(null, {"statusCode": code, "body": message});
}

exports.handler = function (event, context, callback) {
  if (!process.env.ACCESS_KEY || !process.env.S3_BUCKET) {
    return fail('Required env vars not configured', 500, callback);
  }

  const authGiven = event.headers.Authorization;
  if (authGiven.replace('Bearer ', '') !== process.env.ACCESS_KEY) {
    return fail('Not authorised', 401, callback);
  }

  const data = JSON.parse(event.body);
  const encodedImage = data.body;
  const decodedImage = Buffer.from(encodedImage, 'base64');

  if (!decodedImage || !data.accountId || !data.type) {
    return fail('Missing required metadata', 400, callback);
  }

  const mimeType = fileType(decodedImage);
  if (!mimeType) {
    return fail('Unrecognised file type', 400, callback);
  }

  const generatedName = `${uuidv4()}.${mimeType.ext}`;
  const path = `${data.accountId}/${data.type}/${generatedName}`;

  const metadata = {
    SalesforceAccountId: data.accountId,
  };
  // All remaining metadata keys are optional. We can't append `null`s as this is not a valid value for headers.
  if (data.ccampaignId) {
    metadata.SalesforceCCampaignId = data.ccampaignId;
  }
  if (data.contentDocumentId) {
    metadata.SalesforceContentDocumentId = data.contentDocumentId;
  }
  if (data.contentType) {
    metadata.SalesforceContentType = data.contentType;
  }
  if (data.contentVersionId) {
    metadata.SalesforceContentVersionId = data.contentVersionId;
  }
  if (data.name) {
    metadata.SalesforceFilename = data.name;
  }
  if (data.userId) {
    metadata.SalesforceUserId = data.userId;
  }

  const s3Params = {
    ACL: 'public-read',
    Body: decodedImage,
    Bucket: process.env.S3_BUCKET,
    ContentType: mimeType.mime,
    Key: path,
    Metadata: metadata,
  };

  s3.putObject(s3Params, function (error) {
    if (error) {
      fail('Save error: ' + error, 500, callback);
      return;
    }

    callback(null, {"statusCode": 200, "body": JSON.stringify({
      'uri': `https://${process.env.S3_BUCKET}.s3.eu-west-2.amazonaws.com/${path}`,
    })});
  });
}
