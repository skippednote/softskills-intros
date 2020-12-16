import * as DynamoDB from 'aws-sdk/clients/dynamodb';

const { TABLE_NAME } = process.env;
const ddb = new DynamoDB.DocumentClient();

export const handler = async (event: any = {}): Promise<any> => {
  console.log(JSON.stringify(event, null, 2));
  try {
    const { Items } = await ddb
      .scan({
        TableName: TABLE_NAME!,
      })
      .promise();
    // const { Items } = await ddb
    //   .scan({
    //     TableName: TABLE_NAME!,
    //   })
    //   .promise();
    const sortedItems = Items!.sort((a, b) => a.ep - b.ep);
    return {
      statusCode: 201,
      body: JSON.stringify(sortedItems),
      headers: {
        'Cache-Control': 'max-age=86400',
      },
    };
  } catch (e) {
    console.log(e);
    return {
      statusCode: 503,
      body: `Failed store on DynamoDB`,
    };
  }
};
