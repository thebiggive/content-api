'use strict';

import AWS from 'aws-sdk';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

/**
 * @param {string} message Detail to include in JSON as `error` key.
 * @param {number} code
 * @returns {{isBase64Encoded: boolean, headers: {'Content-Type': string}, body, statusCode}}
 */
function fail(message, code) {
  console.log(`Failed with message ${message} and code ${code}`);
  return {
    statusCode: code,
    body: JSON.stringify({
      error: message,
    }),
    isBase64Encoded: false,
    headers: {
      'Content-Type': 'application/json',
    },
  };
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

export const handler = async (event) => {
  return new Promise(async (resolve, _reject) => {
    if (!process.env.ACCESS_KEY || !process.env.S3_BUCKET) {
      return resolve(fail('Required env vars not configured', 500));
    }

    const authGiven = event.headers.Authorization;
    if (authGiven.replace('Bearer ', '') !== process.env.ACCESS_KEY) {
      return resolve(fail('Not authorised', 401));
    }

    const data = JSON.parse(event.body);
    const decodedImage = Buffer.from(data.body, 'base64');

    if (!decodedImage || (!data.accountId && !data.championFundId) || !data.type) {
      return resolve(fail('Missing required metadata', 400));
    }

    // If a championFundId is defined and either accountId and ccampaignID is defined
    // then throw an Id Mistmatch error
    if (data.championFundId && (data.accountId || data.ccampaignId)) {
      return resolve(fail('Id Mismatch', 400));
    }

    const mimeType = await fileTypeFromBuffer(decodedImage);
    if (!mimeType) {
      return resolve(fail('Unrecognised file type', 400));
    }

    const maxSize = 2500;

    // https://github.com/lovell/sharp/issues/1578#issuecomment-474299429
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
            return resolve(fail(`Save error: ${error}. Metadata: ` + JSON.stringify(metadata), 500));
          }

          console.log('Successfully uploaded to S3, path: ' + path);
          return resolve({
            statusCode: 200,
            body: JSON.stringify({
              'uri': `${process.env.IMAGE_ACCESS_BASE_URI}/${path}`,
            }),
            isBase64Encoded: false,
            headers: {
              'Content-Type': 'application/json',
            },
          });
        });
      })

      .catch(sharpError => {
        /**
         * @param {Error} sharpError
         */
        if (sharpError.message.includes('VipsJpeg: Invalid SOS parameters for sequential JPEG')) {
          return resolve(fail('Processing error: corrupt JPEG, invalid SOS parameters', 400));
        }

        if (sharpError.message.includes('VipsJpeg: Premature end of input file')) {
          return resolve(fail('Processing error: corrupt, premature end of input file', 400));
        }

        if (sharpError.message.includes('Input buffer contains unsupported image format')) {
          return resolve(fail('Processing error: unsupported image format', 400));
        }

        return resolve(fail(`Processing error: ${sharpError.message}`, 500));
      })
  });
};
