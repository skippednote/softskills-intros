import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as s3n from '@aws-cdk/aws-s3-notifications';
import * as lambda from '@aws-cdk/aws-lambda';
import { SqsEventSource } from '@aws-cdk/aws-lambda-event-sources';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as iam from '@aws-cdk/aws-iam';
import * as sqs from '@aws-cdk/aws-sqs';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2';
import { LambdaProxyIntegration } from '@aws-cdk/aws-apigatewayv2-integrations';
import { Duration } from '@aws-cdk/core';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as s3deploy from '@aws-cdk/aws-s3-deployment';
import { CloudFrontAllowedMethods } from '@aws-cdk/aws-cloudfront';

export class SoftskillsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      corsPreflight: {
        maxAge: Duration.seconds(86400),
      },
    });

    const layer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'ffmpeg',
      'arn:aws:lambda:us-east-1:448159408791:layer:ffmpeg:1'
    );

    const transcribeQueue = new sqs.Queue(this, 'Queue', {
      visibilityTimeout: Duration.minutes(30),
    });

    const tranlations = new s3.Bucket(this, 'Tranlations', {
      bucketName: 'softskillstranslations',
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const clips = new s3.Bucket(this, 'Clips', {
      bucketName: 'softskillsclips',
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const clipsRole = new iam.Role(this, 'ClipsRole', {
      assumedBy: new iam.ServicePrincipal('transcribe.amazonaws.com'),
    });
    clipsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:GetObjectAcl'],
        resources: [`${clips.bucketArn}/*`],
      })
    );
    clipsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        resources: [`${tranlations.bucketArn}/*`],
      })
    );
    clipsRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['translate:*'],
        resources: [`*`],
      })
    );

    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'text', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'ep', type: dynamodb.AttributeType.NUMBER },
    });

    const trimMedia = new lambda.Function(this, 'TrimMedia', {
      code: lambda.Code.fromAsset('fns/trimMedia'),
      runtime: lambda.Runtime.NODEJS_10_X,
      handler: 'index.handler',
      layers: [layer],
      environment: {
        CLIPS_BUCKET_NAME: clips.bucketName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      memorySize: 1024,
      timeout: Duration.seconds(15),
    });

    trimMedia.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        resources: [`${clips.bucketArn}/*`],
      })
    );

    const getFeedLambda = new lambda.Function(this, 'GetFeed', {
      code: lambda.Code.fromAsset('fns/getFeed'),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      environment: {
        TRIM_MEDIA_ARN: trimMedia.functionArn,
      },
    });

    getFeedLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [trimMedia.functionArn],
      })
    );

    const translateClip = new lambda.Function(this, 'TranslateClip', {
      code: lambda.Code.fromAsset('fns/translateClip'),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      reservedConcurrentExecutions: 1,
      environment: {
        CLIPS_BUCKET_NAME: clips.bucketName,
        TRANSLATIONS_BUCKET_NAME: tranlations.bucketName,
        CLIPS_BUCKET_ARN: clipsRole.roleArn,
      },
    });

    translateClip.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['transcribe:StartTranscriptionJob'],
        resources: ['*'],
      })
    );

    translateClip.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:GetObjectAcl'],
        resources: [`${clips.bucketArn}/*`],
      })
    );

    translateClip.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        resources: [`${tranlations.bucketArn}/*`],
      })
    );

    translateClip.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [`*`],
      })
    );

    const storeOnDynamo = new lambda.Function(this, 'StoreOnDynamo', {
      code: lambda.Code.fromAsset('fns/storeOnDynamo'),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      environment: {
        TRANSLATIONS_BUCKET_NAME: tranlations.bucketName,
        TABLE_NAME: table.tableName,
      },
    });

    storeOnDynamo.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [table.tableArn],
      })
    );

    clips.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(transcribeQueue)
    );

    translateClip.addEventSource(
      new SqsEventSource(transcribeQueue, {
        batchSize: 1,
      })
    );

    tranlations.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(storeOnDynamo)
    );

    const getBytes = new lambda.Function(this, 'GetBytes', {
      code: lambda.Code.fromAsset('fns/getBytes'),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    getBytes.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['dynamodb:Scan'],
        resources: [table.tableArn],
      })
    );

    const httpApiIntegration = new LambdaProxyIntegration({
      handler: getBytes,
    });

    httpApi.addRoutes({
      path: '/api/bytes',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: httpApiIntegration,
    });

    const cfOAI = new cloudfront.OriginAccessIdentity(this, 'cloudfrontOAI');

    const website = new s3.Bucket(this, 'Website', {
      bucketName: 'softskillswebsite',
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          maxAge: 3000,
        },
      ],
    });

    new s3deploy.BucketDeployment(this, 'websiteDeployment', {
      sources: [s3deploy.Source.asset(`frontend`)],
      destinationBucket: website,
    });

    website.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'Grant Cloudfront Origin Access Identity access to S3 bucket',
        actions: ['s3:GetObject'],
        resources: [website.bucketArn + '/*'],
        principals: [cfOAI.grantPrincipal],
      })
    );

    const cfDistribution = new cloudfront.CloudFrontWebDistribution(
      this,
      'cloudfrontDistribution',
      {
        defaultRootObject: 'index.html',
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        originConfigs: [
          {
            customOriginSource: {
              domainName: `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`,
            },
            behaviors: [
              {
                pathPattern: '/api/*',
                allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
                cachedMethods:
                  cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
              },
            ],
          },
          {
            s3OriginSource: {
              s3BucketSource: website,
              originAccessIdentity: cfOAI,
            },
            behaviors: [
              {
                compress: true,
                isDefaultBehavior: true,
                allowedMethods: CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
              },
            ],
          },
        ],
      }
    );
  }
}
