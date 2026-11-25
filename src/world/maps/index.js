// Map registry. Add a map: create a definition module (see test.js for every hook) and list it here.
import test from './test.js';
import brands from './brandsHatch.js';
import spa from './spa.js';
import kart from './kart.js';
import city from './city.js';
import amalfi from './amalfi.js';
import sandown from './sandown.js';

export const MAPS = { [test.id]: test, [brands.id]: brands, [spa.id]: spa, [kart.id]: kart, [city.id]: city, [amalfi.id]: amalfi, [sandown.id]: sandown };
export const DEFAULT_MAP = 'brands';
