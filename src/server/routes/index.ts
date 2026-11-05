import { Hono } from 'hono';
import { catalog } from './catalog';
import { jobs } from './jobs';
import { settings } from './settings';

export const api = new Hono();

api.route('/', settings);
api.route('/', jobs);
api.route('/', catalog);
