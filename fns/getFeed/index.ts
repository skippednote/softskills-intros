import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import * as Lambda from 'aws-sdk/clients/lambda';
const { TRIM_MEDIA_ARN } = process.env;

const lambda = new Lambda();
const feedUrl = 'https://feeds.feedburner.com/SoftSkillsEngineering?fmt=xml';

export const handler = async (event: any = {}): Promise<any> => {
  const response = await fetch(feedUrl);
  const xml = await response.text();
  const js = await parseStringPromise(xml);
  const shows = js.rss.channel[0].item;

  const show$ = shows.map(async (show: any) => {
    const title = (show.title[0] as string).replace(':', '');
    const url = show['media:content'][0]['$']['url'];
    return lambda
      .invoke({
        FunctionName: TRIM_MEDIA_ARN!,
        InvocationType: 'Event',
        Payload: JSON.stringify({ title, url }),
      })
      .promise();
  });

  await Promise.all(show$);

  return { statusCode: 200, body: `Initiated ${shows.length} lambdas` };
};
