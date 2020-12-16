import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import * as S3 from 'aws-sdk/clients/s3';

function string_to_slug(str: string) {
  str = str.replace(/^\s+|\s+$/g, ''); // trim
  str = str.toLowerCase();

  // remove accents, swap ñ for n, etc
  var from = 'àáäâèéëêìíïîòóöôùúüûñç·/_,:;';
  var to = 'aaaaeeeeiiiioooouuuunc------';
  for (var i = 0, l = from.length; i < l; i++) {
    str = str.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i));
  }

  str = str
    .replace(/[^a-z0-9 -]/g, '') // remove invalid chars
    .replace(/\s+/g, '-') // collapse whitespace and replace by -
    .replace(/-+/g, '-'); // collapse dashes

  return str;
}

const { CLIPS_BUCKET_NAME } = process.env;
const s3 = new S3();

export const handler = async (event: any = {}): Promise<any> => {
  try {
    const { title, url } = event;
    const normalizedTitle = string_to_slug(title);
    spawnSync('ffmpeg', [
      '-ss',
      '00:00:00',
      '-t',
      '00:00:30',
      '-i',
      url,
      '-map',
      'a',
      `/tmp/${normalizedTitle}.mp3`,
      '-y',
    ]);
    const buffer = readFileSync(`/tmp/${normalizedTitle}.mp3`);
    await s3
      .upload({
        Bucket: CLIPS_BUCKET_NAME!,
        Key: `${normalizedTitle}.mp3`,
        Body: buffer,
        ACL: 'public-read',
        Metadata: {
          title,
          url,
        },
      })
      .promise();
    return { statusCode: 201, body: 'Stored trimmed file in the bucket' };
  } catch (e) {
    return { statusCode: 503, body: `Failed to trim and store, ${e}` };
  }
};
