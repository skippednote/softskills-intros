import * as S3 from 'aws-sdk/clients/s3';
import * as DynamoDB from 'aws-sdk/clients/dynamodb';

const { TRANSLATIONS_BUCKET_NAME, TABLE_NAME } = process.env;
const s3 = new S3();
const ddb = new DynamoDB.DocumentClient();

export const handler = async (event: any = {}): Promise<any> => {
  console.log(JSON.stringify(event));
  try {
    event.Records.forEach(async (event: any) => {
      const { key } = event.s3.object;
      if (key === '.write_access_check_file.temp') {
        console.log('SKIPPED TEMP FILE');
        return { statusCode: 201, body: `skipping the temp file.` };
      } else {
        const { Body } = await s3
          .getObject({
            Bucket: TRANSLATIONS_BUCKET_NAME!,
            Key: key,
          })
          .promise();

        let {
          jobName,
          results: {
            transcripts: [transcript],
          },
        } = JSON.parse(Body?.toString('ascii') as any);
        transcript = transcript.transcript;
        const start = transcript.toLowerCase().indexOf('it takes more than');
        const end = transcript.toLowerCase().indexOf('engineer');
        const episodeNumber = (jobName as string)
          .match(/episode-\d{1,3}/)![0]
          .replace('episode-', '');
        let message = '';

        if (start > -1 && end > -1) {
          message = transcript.slice(start, end + 'engineer'.length);
          await ddb
            .put({
              TableName: TABLE_NAME!,
              Item: {
                text: message,
                ep: Number(episodeNumber),
              },
            })
            .promise();
        }
        console.log({ start, end, episodeNumber, message });
        return { statusCode: 201, body: `Stored on DynamoDB: ${message}` };
      }
    });
  } catch (e) {
    console.log(e);
    return { statusCode: 503, body: `Failed store on DynamoDB` };
  }
};
