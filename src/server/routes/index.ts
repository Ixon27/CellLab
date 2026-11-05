import { Hono } from 'hono';
import { catalog } from './catalog';
import { jobs } from './jobs';
import { settings } from './settings';
import { cellLines } from './cell-lines';
import { protocols } from './protocols';
import { literature } from './literature';
import { bradford } from './bradford';
import { western } from './western';
import { lineage } from './lineage';

export const api = new Hono();

api.route('/', settings);
api.route('/', jobs);
api.route('/', catalog);
api.route('/', cellLines);
api.route('/', protocols);
api.route('/', literature);
api.route('/', bradford);
api.route('/', western);
api.route('/', lineage);
