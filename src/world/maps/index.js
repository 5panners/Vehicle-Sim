// Map registry. Add a map: create a definition module (see test.js for every hook) and list it here.
import test from './test.js';
import brands from './brandsHatch.js';
import spa from './spa.js';

export const MAPS = { [test.id]: test, [brands.id]: brands, [spa.id]: spa };
export const DEFAULT_MAP = 'test';
