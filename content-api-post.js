'use strict';

import AWS from 'aws-sdk';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import uuidv4 from 'uuid/v4';

function fail(message, code, callback) {
  if (code == 500) {
    callback(new Error(message));
    return;
  }

  callback(null, {"statusCode": code, "body": message});
}

/**
 * Get a version of untrusted input which is URL-encoded for S3 metadata storage.
 * Note that *when using REST* as the S3 SDK does, values only reliably support
 * US-ASCII and not UTF-8, hence the more aggressive encoding.
 * {@link https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html}
 *
 * @param {string} input
 * @returns {string}
 */
function metadataEscape(input) {
  return encodeURIComponent(input);
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

  // If a championFundId is defined and either accountId and ccampaignID is defined
  // then throw an Id Mistmatch error
  if (data.championFundId && (data.accountId || data.ccampaignId)) {
    return fail('Id Mismatch', 400, callback);
  }

  const mimeType = fileTypeFromBuffer(decodedImage);
  if (!mimeType) {
    return fail('Unrecognised file type', 400, callback);
  }

  const maxSize = 2500;

  // https://github.com/lovell/sharp/issues/1578#issuecomment-474299429
  sharp(decodedImage, { failOnError: false })
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
      const salesforcePathId = data.accountId ? data.accountId : data.championFundId;
      const path = `${salesforcePathId}/${data.type}/${generatedName}`;
      const metadata = {};

      // Assign the Account or Champion Fund record Id.
      // We know at least one of these exist before reaching here
      if (data.accountId) {
        metadata.SalesforceAccountId = data.accountId;
      }
      if (data.championFundId) {
        metadata.SalesforceChampionFundId = data.championFundId;
      }

      // All remaining metadata keys are optional. We can't append `null`s as this is not a valid value for headers.
      if (data.ccampaignId) {
        metadata.SalesforceCCampaignId = data.ccampaignId;
      }
      if (data.contentDocumentId) {
        metadata.SalesforceContentDocumentId = data.contentDocumentId;
      }
      if (data.contentType) {
        metadata.SalesforceContentType = metadataEscape(data.contentType);
      }
      if (data.contentVersionId) {
        metadata.SalesforceContentVersionId = data.contentVersionId;
      }
      if (data.name) {
        metadata.SalesforceFilename = metadataEscape(data.name);
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
          fail(`Save error: ${error}. Metadata: ` + JSON.stringify(metadata), 500, callback);
          return;
        }

        callback(null, {"statusCode": 200, "body": JSON.stringify({
          'uri': `${process.env.IMAGE_ACCESS_BASE_URI}/${path}`,
        })});
      });
    })

    .catch(sharpError => {
      /**
       * @param {Error} sharpError
       */
      if (sharpError.message.includes('VipsJpeg: Invalid SOS parameters for sequential JPEG')) {
        fail('Processing error: corrupt JPEG, invalid SOS parameters', 400, callback);
        return;
      }

      if (sharpError.message.includes('Input buffer contains unsupported image format')) {
        fail('Processing error: unsupported image format', 400, callback);
        return;
      }

      fail('Processing error: ' + sharpError, 500, callback);
    })
};
