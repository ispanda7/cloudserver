const assert = require('assert');
const AWS = require('aws-sdk');
const async = require('async');
const crypto = require('crypto');
const { versioning } = require('arsenal');
const versionIdUtils = versioning.VersionID;

const { makeid } = require('../../unit/helpers');
const { makeRequest } = require('../../functional/raw-node/utils/makeRequest');
const BucketUtility =
      require('../../functional/aws-node-sdk/lib/utility/bucket-util');
const { describeSkipIfNotMultiple, awsLocation } =
    require('../../functional/aws-node-sdk/test/multipleBackend/utils');
const { getRealAwsConfig } =
      require('../../functional/aws-node-sdk/test/support/awsConfig');
const { config } = require('../../../lib/Config');

const awsConfig = getRealAwsConfig(awsLocation);
const awsClient = new AWS.S3(awsConfig);

const ipAddress = process.env.IP ? process.env.IP : '127.0.0.1';
const describeSkipIfAWS = process.env.AWS_ON_AIR ? describe.skip : describe;

const backbeatAuthCredentials = {
    accessKey: 'accessKey1',
    secretKey: 'verySecretKey1',
};

const TEST_BUCKET = 'backbeatbucket';
const TEST_KEY = 'fookey';
const NONVERSIONED_BUCKET = 'backbeatbucket-non-versioned';

const testArn = 'aws::iam:123456789012:user/bart';
const testKey = 'testkey';
const testKeyUTF8 = '䆩鈁櫨㟔罳';
const testData = 'testkey data';
const testDataMd5 = crypto.createHash('md5')
          .update(testData, 'utf-8')
          .digest('hex');
const testMd = {
    'md-model-version': 2,
    'owner-display-name': 'Bart',
    'owner-id': ('79a59df900b949e55d96a1e698fbaced' +
                 'fd6e09d98eacf8f8d5218e7cd47ef2be'),
    'last-modified': '2017-05-15T20:32:40.032Z',
    'content-length': testData.length,
    'content-md5': testDataMd5,
    'x-amz-server-version-id': '',
    'x-amz-storage-class': 'STANDARD',
    'x-amz-server-side-encryption': '',
    'x-amz-server-side-encryption-aws-kms-key-id': '',
    'x-amz-server-side-encryption-customer-algorithm': '',
    'location': null,
    'acl': {
        Canned: 'private',
        FULL_CONTROL: [],
        WRITE_ACP: [],
        READ: [],
        READ_ACP: [],
    },
    'nullVersionId': '99999999999999999999RG001  ',
    'isDeleteMarker': false,
    'versionId': '98505119639965999999RG001  9',
    'replicationInfo': {
        status: 'COMPLETED',
        backends: [{ site: 'zenko', status: 'PENDING' }],
        content: ['DATA', 'METADATA'],
        destination: 'arn:aws:s3:::dummy-dest-bucket',
        storageClass: 'STANDARD',
    },
};

const nonVersionedTestMd = {
    'owner-display-name': 'Bart',
    'owner-id': ('79a59df900b949e55d96a1e698fbaced' +
                 'fd6e09d98eacf8f8d5218e7cd47ef2be'),
    'content-length': testData.length,
    'content-md5': testDataMd5,
    'x-amz-version-id': 'null',
    'x-amz-server-version-id': '',
    'x-amz-storage-class': 'awsbackend',
    'x-amz-server-side-encryption': '',
    'x-amz-server-side-encryption-aws-kms-key-id': '',
    'x-amz-server-side-encryption-customer-algorithm': '',
    'acl': {
        Canned: 'private',
        FULL_CONTROL: [],
        WRITE_ACP: [],
        READ: [],
        READ_ACP: [],
    },
    'location': null,
    'isNull': '',
    'nullVersionId': '',
    'isDeleteMarker': false,
    'tags': {},
    'replicationInfo': {
        status: '',
        backends: [],
        content: [],
        destination: '',
        storageClass: '',
        role: '',
        storageType: '',
        dataStoreVersionId: '',
        isNFS: null,
    },
    'dataStoreName': 'us-east-1',
    'last-modified': '2018-12-18T01:22:15.986Z',
    'md-model-version': 3,
};

function checkObjectData(s3, bucket, objectKey, dataValue, done) {
    s3.getObject({
        Bucket: bucket,
        Key: objectKey,
    }, (err, data) => {
        assert.ifError(err);
        assert.strictEqual(data.Body.toString(), dataValue);
        done();
    });
}

/** makeBackbeatRequest - utility function to generate a request going
 * through backbeat route
 * @param {object} params - params for making request
 * @param {string} params.method - request method
 * @param {string} params.bucket - bucket name
 * @param {string} params.objectKey - object key
 * @param {string} params.subCommand - subcommand to backbeat
 * @param {object} [params.headers] - headers and their string values
 * @param {object} [params.authCredentials] - authentication credentials
 * @param {object} params.authCredentials.accessKey - access key
 * @param {object} params.authCredentials.secretKey - secret key
 * @param {string} [params.requestBody] - request body contents
 * @param {function} callback - with error and response parameters
 * @return {undefined} - and call callback
 */
function makeBackbeatRequest(params, callback) {
    const { method, headers, bucket, objectKey, resourceType,
            authCredentials, requestBody, queryObj } = params;
    const options = {
        authCredentials,
        hostname: ipAddress,
        port: 8000,
        method,
        headers,
        path: `/_/backbeat/${resourceType}/${bucket}/${objectKey}`,
        requestBody,
        jsonResponse: true,
        queryObj,
    };
    makeRequest(options, callback);
}

describeSkipIfNotMultiple('backbeat DELETE routes', () => {
    it('abort MPU', done => {
        const awsBucket =
              config.locationConstraints[awsLocation].details.bucketName;
        const awsKey = 'backbeat-mpu-test';
        async.waterfall([
            next =>
                awsClient.createMultipartUpload({
                    Bucket: awsBucket,
                    Key: awsKey,
                }, next),
            (response, next) => {
                const { UploadId } = response;
                makeBackbeatRequest({
                    method: 'DELETE',
                    bucket: awsBucket,
                    objectKey: awsKey,
                    resourceType: 'multiplebackenddata',
                    queryObj: { operation: 'abortmpu' },
                    headers: {
                        'x-scal-upload-id': UploadId,
                        'x-scal-storage-type': 'aws_s3',
                        'x-scal-storage-class': awsLocation,
                    },
                    authCredentials: backbeatAuthCredentials,
                }, (err, response) => {
                    assert.ifError(err);
                    assert.strictEqual(response.statusCode, 200);
                    assert.deepStrictEqual(JSON.parse(response.body), {});
                    return next(null, UploadId);
                });
            }, (UploadId, next) =>
                awsClient.listMultipartUploads({
                    Bucket: awsBucket,
                }, (err, response) => {
                    assert.ifError(err);
                    const hasOngoingUpload =
                        response.Uploads.some(upload => (upload === UploadId));
                    assert(!hasOngoingUpload);
                    return next();
                }),
        ], err => {
            assert.ifError(err);
            done();
        });
    });
});

describeSkipIfAWS('backbeat routes', () => {
    let bucketUtil;
    let s3;

    before(done => {
        bucketUtil = new BucketUtility(
            'default', { signatureVersion: 'v4' });
        s3 = bucketUtil.s3;
        s3.createBucketAsync({ Bucket: TEST_BUCKET })
            .then(() => s3.putBucketVersioningAsync(
                {
                    Bucket: TEST_BUCKET,
                    VersioningConfiguration: { Status: 'Enabled' },
                }))
            .then(() => s3.createBucketAsync({ Bucket: NONVERSIONED_BUCKET }))
            .then(() => done())
            .catch(err => {
                process.stdout.write(`Error creating bucket: ${err}\n`);
                throw err;
            });
    });
    after(done => {
        bucketUtil.empty(TEST_BUCKET)
            .then(() => s3.deleteBucketAsync({ Bucket: TEST_BUCKET }))
            .then(() => bucketUtil.empty(NONVERSIONED_BUCKET))
            .then(() => s3.deleteBucketAsync({ Bucket: NONVERSIONED_BUCKET }))
            .then(() => done());
    });

    describe('backbeat PUT routes', () => {
        describe('PUT data + metadata should create a new complete object',
        () => {
            [{
                caption: 'with ascii test key',
                key: testKey, encodedKey: testKey,
            },
            {
                caption: 'with UTF8 key',
                key: testKeyUTF8, encodedKey: encodeURI(testKeyUTF8),
            },
            {
                caption: 'with percents and spaces encoded as \'+\' in key',
                key: '50% full or 50% empty',
                encodedKey: '50%25+full+or+50%25+empty',
            }].concat([
                `${testKeyUTF8}/${testKeyUTF8}/%42/mykey`,
                'Pâtisserie=中文-español-English',
                'notes/spring/1.txt',
                'notes/spring/2.txt',
                'notes/spring/march/1.txt',
                'notes/summer/1.txt',
                'notes/summer/2.txt',
                'notes/summer/august/1.txt',
                'notes/year.txt',
                'notes/yore.rs',
                'notes/zaphod/Beeblebrox.txt',
            ].map(key => ({
                key, encodedKey: encodeURI(key),
                caption: `with key ${key}`,
            })))
            .forEach(testCase => {
                it(testCase.caption, done => {
                    async.waterfall([next => {
                        makeBackbeatRequest({
                            method: 'PUT', bucket: TEST_BUCKET,
                            objectKey: testCase.encodedKey,
                            resourceType: 'data',
                            headers: {
                                'content-length': testData.length,
                                'content-md5': testDataMd5,
                                'x-scal-canonical-id': testArn,
                            },
                            authCredentials: backbeatAuthCredentials,
                            requestBody: testData }, next);
                    }, (response, next) => {
                        assert.strictEqual(response.statusCode, 200);
                        const newMd = Object.assign({}, testMd);
                        newMd.location = JSON.parse(response.body);
                        makeBackbeatRequest({
                            method: 'PUT', bucket: TEST_BUCKET,
                            objectKey: testCase.encodedKey,
                            resourceType: 'metadata',
                            authCredentials: backbeatAuthCredentials,
                            requestBody: JSON.stringify(newMd),
                        }, next);
                    }, (response, next) => {
                        assert.strictEqual(response.statusCode, 200);
                        checkObjectData(s3, TEST_BUCKET, testCase.key, testData,
                            next);
                    }], err => {
                        assert.ifError(err);
                        done();
                    });
                });
            });
        });

        it('should PUT metadata for a non-versioned bucket', done => {
            const bucket = NONVERSIONED_BUCKET;
            const objectKey = 'non-versioned-key';
            async.waterfall([
                next =>
                    makeBackbeatRequest({
                        method: 'PUT',
                        bucket,
                        objectKey,
                        resourceType: 'data',
                        headers: {
                            'content-length': testData.length,
                            'content-md5': testDataMd5,
                            'x-scal-canonical-id': testArn,
                        },
                        authCredentials: backbeatAuthCredentials,
                        requestBody: testData,
                    }, (err, response) => {
                        assert.ifError(err);
                        const metadata = Object.assign({}, nonVersionedTestMd, {
                            location: JSON.parse(response.body),
                        });
                        return next(null, metadata);
                    }),
                (metadata, next) =>
                    makeBackbeatRequest({
                        method: 'PUT',
                        bucket,
                        objectKey,
                        resourceType: 'metadata',
                        authCredentials: backbeatAuthCredentials,
                        requestBody: JSON.stringify(metadata),
                    }, (err, response) => {
                        assert.ifError(err);
                        assert.strictEqual(response.statusCode, 200);
                        next();
                    }),
                next =>
                    s3.headObject({
                        Bucket: bucket,
                        Key: objectKey,
                    }, (err, data) => {
                        assert.ifError(err);
                        assert.strictEqual(data.StorageClass, 'awsbackend');
                        next();
                    }),
                next => checkObjectData(s3, bucket, objectKey, testData, next),
            ], done);
        });

        it('PUT metadata with "x-scal-replication-content: METADATA"' +
        'header should replicate metadata only', done => {
            async.waterfall([next => {
                makeBackbeatRequest({
                    method: 'PUT', bucket: TEST_BUCKET,
                    objectKey: 'test-updatemd-key',
                    resourceType: 'data',
                    headers: {
                        'content-length': testData.length,
                        'content-md5': testDataMd5,
                        'x-scal-canonical-id': testArn,
                    },
                    authCredentials: backbeatAuthCredentials,
                    requestBody: testData,
                }, next);
            }, (response, next) => {
                assert.strictEqual(response.statusCode, 200);
                const newMd = Object.assign({}, testMd);
                newMd.location = JSON.parse(response.body);
                makeBackbeatRequest({
                    method: 'PUT', bucket: TEST_BUCKET,
                    objectKey: 'test-updatemd-key',
                    resourceType: 'metadata',
                    authCredentials: backbeatAuthCredentials,
                    requestBody: JSON.stringify(newMd),
                }, next);
            }, (response, next) => {
                assert.strictEqual(response.statusCode, 200);
                const newMd = Object.assign({}, testMd);
                makeBackbeatRequest({
                    method: 'PUT', bucket: TEST_BUCKET,
                    objectKey: 'test-updatemd-key',
                    resourceType: 'metadata',
                    headers: { 'x-scal-replication-content': 'METADATA' },
                    authCredentials: backbeatAuthCredentials,
                    requestBody: JSON.stringify(newMd),
                }, next);
            }, (response, next) => {
                assert.strictEqual(response.statusCode, 200);
                checkObjectData(s3, TEST_BUCKET, 'test-updatemd-key', testData,
                    next);
            }], err => {
                assert.ifError(err);
                done();
            });
        });

        it('should refuse PUT data if no x-scal-canonical-id header ' +
           'is provided', done => makeBackbeatRequest({
               method: 'PUT', bucket: TEST_BUCKET,
               objectKey: testKey, resourceType: 'data',
               headers: {
                   'content-length': testData.length,
                   'content-md5': testDataMd5,
               },
               authCredentials: backbeatAuthCredentials,
               requestBody: testData,
           },
           err => {
               assert.strictEqual(err.code, 'BadRequest');
               done();
           }));

        it('should refuse PUT data if no content-md5 header is provided',
        done => makeBackbeatRequest({
            method: 'PUT', bucket: TEST_BUCKET,
            objectKey: testKey, resourceType: 'data',
            headers: {
                'content-length': testData.length,
                'x-scal-canonical-id': testArn,
            },
            authCredentials: backbeatAuthCredentials,
            requestBody: testData,
        },
        err => {
            assert.strictEqual(err.code, 'BadRequest');
            done();
        }));

        it('should refuse PUT in metadata-only mode if object does not exist',
        done => {
            async.waterfall([next => {
                const newMd = Object.assign({}, testMd);
                makeBackbeatRequest({
                    method: 'PUT', bucket: TEST_BUCKET,
                    objectKey: 'does-not-exist',
                    resourceType: 'metadata',
                    headers: { 'x-scal-replication-content': 'METADATA' },
                    authCredentials: backbeatAuthCredentials,
                    requestBody: JSON.stringify(newMd),
                }, next);
            }], err => {
                assert.strictEqual(err.statusCode, 404);
                done();
            });
        });
    });
    describe('backbeat authorization checks', () => {
        [{ method: 'PUT', resourceType: 'metadata' },
         { method: 'PUT', resourceType: 'data' }].forEach(test => {
             it(`${test.method} ${test.resourceType} should respond with ` +
             '403 Forbidden if no credentials are provided',
             done => {
                 makeBackbeatRequest({
                     method: test.method, bucket: TEST_BUCKET,
                     objectKey: TEST_KEY, resourceType: test.resourceType,
                 },
                 err => {
                     assert(err);
                     assert.strictEqual(err.statusCode, 403);
                     assert.strictEqual(err.code, 'AccessDenied');
                     done();
                 });
             });
             it(`${test.method} ${test.resourceType} should respond with ` +
                '403 Forbidden if wrong credentials are provided',
                done => {
                    makeBackbeatRequest({
                        method: test.method, bucket: TEST_BUCKET,
                        objectKey: TEST_KEY, resourceType: test.resourceType,
                        authCredentials: {
                            accessKey: 'wrong',
                            secretKey: 'still wrong',
                        },
                    },
                    err => {
                        assert(err);
                        assert.strictEqual(err.statusCode, 403);
                        assert.strictEqual(err.code, 'InvalidAccessKeyId');
                        done();
                    });
                });
             it(`${test.method} ${test.resourceType} should respond with ` +
                '403 Forbidden if the account does not match the ' +
                'backbeat user',
                done => {
                    makeBackbeatRequest({
                        method: test.method, bucket: TEST_BUCKET,
                        objectKey: TEST_KEY, resourceType: test.resourceType,
                        authCredentials: {
                            accessKey: 'accessKey2',
                            secretKey: 'verySecretKey2',
                        },
                    },
                    err => {
                        assert(err);
                        assert.strictEqual(err.statusCode, 403);
                        assert.strictEqual(err.code, 'AccessDenied');
                        done();
                    });
                });
             it(`${test.method} ${test.resourceType} should respond with ` +
                '403 Forbidden if backbeat user has wrong secret key',
                done => {
                    makeBackbeatRequest({
                        method: test.method, bucket: TEST_BUCKET,
                        objectKey: TEST_KEY, resourceType: test.resourceType,
                        authCredentials: {
                            accessKey: backbeatAuthCredentials.accessKey,
                            secretKey: 'hastalavista',
                        },
                    },
                    err => {
                        assert(err);
                        assert.strictEqual(err.statusCode, 403);
                        assert.strictEqual(err.code, 'SignatureDoesNotMatch');
                        done();
                    });
                });
         });
        it('GET  /_/backbeat/api/... should respond with ' +
           '503 on authenticated requests (API server down)',
           done => {
               const options = {
                   authCredentials: {
                       accessKey: 'accessKey2',
                       secretKey: 'verySecretKey2',
                   },
                   hostname: ipAddress,
                   port: 8000,
                   method: 'GET',
                   path: '/_/backbeat/api/crr/failed',
                   jsonResponse: true,
               };
               makeRequest(options, err => {
                   assert(err);
                   assert.strictEqual(err.statusCode, 503);
                   assert.strictEqual(err.code, 'ServiceUnavailable');
                   done();
               });
           });
        it('GET  /_/backbeat/api/... should respond with ' +
           '403 Forbidden if the request is unauthenticated',
           done => {
               const options = {
                   hostname: ipAddress,
                   port: 8000,
                   method: 'GET',
                   path: '/_/backbeat/api/crr/failed',
                   jsonResponse: true,
               };
               makeRequest(options, err => {
                   assert(err);
                   assert.strictEqual(err.statusCode, 403);
                   assert.strictEqual(err.code, 'AccessDenied');
                   done();
               });
           });
    });

    describe('GET Metadata route', () => {
        beforeEach(done => makeBackbeatRequest({
            method: 'PUT', bucket: TEST_BUCKET,
            objectKey: TEST_KEY,
            resourceType: 'metadata',
            authCredentials: backbeatAuthCredentials,
            requestBody: JSON.stringify(testMd),
        }, done));

        it('should return metadata blob for a versionId', done => {
            makeBackbeatRequest({
                method: 'GET', bucket: TEST_BUCKET,
                objectKey: TEST_KEY, resourceType: 'metadata',
                authCredentials: backbeatAuthCredentials,
                queryObj: {
                    versionId: versionIdUtils.encode(testMd.versionId),
                },
            }, (err, data) => {
                const parsedBody = JSON.parse(JSON.parse(data.body).Body);
                assert.strictEqual(data.statusCode, 200);
                assert.deepStrictEqual(parsedBody, testMd);
                done();
            });
        });

        it('should return error if bucket does not exist', done => {
            makeBackbeatRequest({
                method: 'GET', bucket: 'blah',
                objectKey: TEST_KEY, resourceType: 'metadata',
                authCredentials: backbeatAuthCredentials,
                queryObj: {
                    versionId: versionIdUtils.encode(testMd.versionId),
                },
            }, (err, data) => {
                assert.strictEqual(data.statusCode, 404);
                assert.strictEqual(JSON.parse(data.body).code, 'NoSuchBucket');
                done();
            });
        });

        it('should return error if object does not exist', done => {
            makeBackbeatRequest({
                method: 'GET', bucket: TEST_BUCKET,
                objectKey: 'blah', resourceType: 'metadata',
                authCredentials: backbeatAuthCredentials,
                queryObj: {
                    versionId: versionIdUtils.encode(testMd.versionId),
                },
            }, (err, data) => {
                assert.strictEqual(data.statusCode, 404);
                assert.strictEqual(JSON.parse(data.body).code, 'ObjNotFound');
                done();
            });
        });
    });
    describe('Batch Delete Route', () => {
        it('should batch delete a local location', done => {
            let versionId;
            let location;
            const testKey = 'batch-delete-test-key';

            async.series([
                done => s3.putObject({
                    Bucket: TEST_BUCKET,
                    Key: testKey,
                    Body: new Buffer('hello'),
                }, (err, data) => {
                    assert.ifError(err);
                    versionId = data.VersionId;
                    done();
                }),
                done => {
                    makeBackbeatRequest({
                        method: 'GET', bucket: TEST_BUCKET,
                        objectKey: testKey,
                        resourceType: 'metadata',
                        authCredentials: backbeatAuthCredentials,
                        queryObj: {
                            versionId,
                        },
                    }, (err, data) => {
                        assert.ifError(err);
                        assert.strictEqual(data.statusCode, 200);
                        const metadata = JSON.parse(
                            JSON.parse(data.body).Body);
                        location = metadata.location;
                        done();
                    });
                },
                done => {
                    const options = {
                        authCredentials: backbeatAuthCredentials,
                        hostname: ipAddress,
                        port: 8000,
                        method: 'POST',
                        path: '/_/backbeat/batchdelete',
                        requestBody:
                        `{"Locations":${JSON.stringify(location)}}`,
                        jsonResponse: true,
                    };
                    makeRequest(options, done);
                },
                done => s3.getObject({
                    Bucket: TEST_BUCKET,
                    Key: testKey,
                }, err => {
                    // should error out as location shall no longer exist
                    assert(err);
                    done();
                }),
            ], done);
        });
        it('should batch delete a versioned AWS location', done => {
            let versionId;
            const awsBucket =
                  config.locationConstraints[awsLocation].details.bucketName;
            const awsKey = `${TEST_BUCKET}/batch-delete-test-key-${makeid(8)}`;

            async.series([
                done => awsClient.putObject({
                    Bucket: awsBucket,
                    Key: awsKey,
                    Body: new Buffer('hello'),
                }, (err, data) => {
                    assert.ifError(err);
                    versionId = data.VersionId;
                    done();
                }),
                done => {
                    const location = [{
                        key: awsKey,
                        size: 5,
                        dataStoreName: awsLocation,
                        dataStoreVersionId: versionId,
                    }];
                    const reqBody = `{"Locations":${JSON.stringify(location)}}`;
                    const options = {
                        authCredentials: backbeatAuthCredentials,
                        hostname: ipAddress,
                        port: 8000,
                        method: 'POST',
                        path: '/_/backbeat/batchdelete',
                        requestBody: reqBody,
                        jsonResponse: true,
                    };
                    makeRequest(options, done);
                },
                done => awsClient.getObject({
                    Bucket: awsBucket,
                    Key: awsKey,
                }, err => {
                    // should error out as location shall no longer exist
                    assert(err);
                    done();
                }),
            ], done);
        });
        it('should fail with error if given malformed JSON', done => {
            async.series([
                done => {
                    const options = {
                        authCredentials: backbeatAuthCredentials,
                        hostname: ipAddress,
                        port: 8000,
                        method: 'POST',
                        path: '/_/backbeat/batchdelete',
                        requestBody: 'NOTJSON',
                        jsonResponse: true,
                    };
                    makeRequest(options, done);
                },
            ], err => {
                assert(err);
                done();
            });
        });
        it('should skip batch delete of a non-existent location', done => {
            async.series([
                done => {
                    const options = {
                        authCredentials: backbeatAuthCredentials,
                        hostname: ipAddress,
                        port: 8000,
                        method: 'POST',
                        path: '/_/backbeat/batchdelete',
                        requestBody:
                        '{"Locations":' +
                            '[{"key":"abcdef","dataStoreName":"us-east-1"}]}',
                        jsonResponse: true,
                    };
                    makeRequest(options, done);
                },
            ], done);
        });
    });
});
