'use strict';

const AWS = require('aws-sdk');
const fileType = require('file-type');
const sharp = require('sharp');
const uuidv4 = require('uuid/v4');

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
  const decodedImage = Buffer.from(data.body, 'base64');

  if (!decodedImage || (!data.accountId && !data.championFundId) || !data.type) {
    return fail('Missing required metadata', 400, callback);
  }

  if (data.championFundId && data.ccampaignId) {
    return fail('Id Mismatch', 400, callback);
  }

  const mimeType = fileType(decodedImage);
  if (!mimeType) {
    return fail('Unrecognised file type', 400, callback);
  }

  const maxSize = 2500;

  sharp(decodedImage)
    .resize({
      fit: sharp.fit.inside,
      withoutEnlargement: true,
      width: maxSize,
      height: maxSize,
    })
    .jpeg({ progressive: true, quality: 85, force: false })
    .png( { progressive: true, compressionLevel: 9, adaptiveFiltering: true, force: false })
    .withMetadata()
    .toBuffer()
    .then(processedImage => {
      const generatedName = `${uuidv4()}.${mimeType.ext}`;
      const path = `${data.accountId}/${data.type}/${generatedName}`;
      const metadata = {
        SalesforceAccountId: data.accountId,
      };
      // All remaining metadata keys are optional. We can't append `null`s as this is not a valid value for headers.
      if (data.championFundId) {
        metadata.SalesforceChampionFundId = data.championFundId;
      }
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
        Body: processedImage,
        Bucket: process.env.S3_BUCKET,
        ContentType: mimeType.mime,
        Key: path,
        Metadata: metadata,
      };

      const s3 = new AWS.S3({signatureVersion: 'v4'});
      s3.putObject(s3Params, function (error) {
        if (error) {
          fail('Save error: ' + error, 500, callback);
          return;
        }
    
        callback(null, {"statusCode": 200, "body": JSON.stringify({
          'uri': `${process.env.IMAGE_ACCESS_BASE_URI}/${path}`,
        })});
      });
    })
    .catch(sharpError => {
      fail('Processing error: ' + sharpError, 500, callback);
    })
};
