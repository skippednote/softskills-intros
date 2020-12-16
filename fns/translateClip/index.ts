import * as TranscribeService from 'aws-sdk/clients/transcribeservice';
const { TRANSLATIONS_BUCKET_NAME, CLIPS_BUCKET_ARN } = process.env;
const ts = new TranscribeService();

export const handler = async (event: any = {}): Promise<any> => {
  try {
    console.log(JSON.stringify(event, null, 2));
    const { Records } = JSON.parse(event.Records[0].body);
    Records.forEach(async (record: any) => {
      const { object, bucket } = record.s3;
      const key = decodeURI(object.key);
      console.log(`s3://${bucket.name}/${key}`);

      const a = await ts
        .startTranscriptionJob({
          TranscriptionJobName: key.replace('.mp3', ''),
          Media: {
            MediaFileUri: `s3://${bucket.name}/${key}`,
          },
          LanguageCode: 'en-US',
          OutputBucketName: TRANSLATIONS_BUCKET_NAME!,
          JobExecutionSettings: {
            AllowDeferredExecution: true,
            DataAccessRoleArn: CLIPS_BUCKET_ARN,
          },
        })
        .promise();
      console.log({ key, res: JSON.stringify(a, null, 2) });
    });

    return { statusCode: 201, body: 'Queued for Transcribing!' };
  } catch (e) {
    console.log(e);
    return { statusCode: 503, body: `Failed to transcribe, ${e}` };
  }
};
