'use strict'

const AWS = require('aws-sdk');
const fileType = require('file-type');
const sharp = require('sharp')
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

  if (!decodedImage || !data.accountId || !data.type) {
    return fail('Missing required metadata', 400, callback);
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
      const s3Params = {
        ACL: 'public-read',
        Body: processedImage,
        Bucket: process.env.S3_BUCKET,
        ContentType: mimeType.mime,
        Key: path,
        Metadata: {
          SalesforceAccountId: data.accountId,
          SalesforceCCampaignId: data.ccampaignId ? data.ccampaignId : null,
          SalesforceContentDocumentId: data.contentDocumentId ? data.contentDocumentId : null,
          SalesforceContentType: data.contentType ? data.contentType : null,
          SalesforceContentVersionId: data.contentVersionId ? data.contentVersionId : null,
          SalesforceFilename: data.name ? data.name : null,
          SalesforceUserId: data.userId ? data.userId : null,
        }
      };

      const s3 = new AWS.S3({signatureVersion: 'v4'});
      s3.putObject(s3Params, function (error) {
        if (error) {
          fail('Save error: ' + error, 500, callback);
          return;
        }
    
        callback(null, {"statusCode": 200, "body": JSON.stringify({
          // TODO generalise base image handling so it looks like this
          // 'uri': `${process.env.IMAGE_ACCESS_BASE_URI}/${path}`,
          'uri': `https://${process.env.S3_BUCKET}.s3.eu-west-2.amazonaws.com/${path}`,
        })});
      });
    })
    .catch(sharpError => {
      fail('Processing error: ' + sharpError, 500, callback);
      return;
    })
}
