import { expect as expectCDK, matchTemplate, MatchStyle } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import * as Softskills from '../lib/softskills-stack';

test('Empty Stack', () => {
    const app = new cdk.App();
    // WHEN
    const stack = new Softskills.SoftskillsStack(app, 'MyTestStack');
    // THEN
    expectCDK(stack).to(matchTemplate({
      "Resources": {}
    }, MatchStyle.EXACT))
});
