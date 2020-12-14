#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { SoftskillsStack } from '../lib/softskills-stack';

const app = new cdk.App();
new SoftskillsStack(app, 'SoftskillsStack');
