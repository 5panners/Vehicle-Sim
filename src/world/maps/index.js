// Map registry. Add a map: create a definition module (see test.js for every hook) and list it here.
import test from './test.js';
import brands from './brandsHatch.js';
import spa from './spa.js';
import kart from './kart.js';
import city from './city.js';
import rocky from './rocky.js';
import amalfi from './amalfi.js';

export const MAPS = { [test.id]: test, [brands.id]: brands, [spa.id]: spa, [kart.id]: kart, [city.id]: city, [rocky.id]: rocky, [amalfi.id]: amalfi };
export const DEFAULT_MAP = 'brands';
