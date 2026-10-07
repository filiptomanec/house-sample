// Test fixture: the fictional house (concept C) reduced to what the site code needs.
// Mirrors the shape of derived.json (outline, roofs, openings) and house.json (outdoor); no real data.
import type { HouseInput } from "../types";

export const FIXTURE_BEARING_DEG = 12;

export const FIXTURE_HOUSE: HouseInput = {
  bearingDeg: FIXTURE_BEARING_DEG,
  footprint: [[6.4, -0.25], [23.25, -0.25], [23.25, 12.05], [-0.25, 12.05], [-0.25, 5.15], [6.4, 5.15]],
  outdoor: [
    {type:"terrace", covered:true, rect:[-0.25, -0.25, 6.4, 5.15]},
    {type:"paving", covered:false, rect:[-0.25, -4, 13.6, -0.25]},
    {type:"paving", covered:true, rect:[15.7, 12.05, 19.3, 14.45]},
    {type:"drive", covered:false, rect:[0.2, 12.05, 6.4, 20.5]},
    {type:"path", covered:false, rect:[16.8, 14.45, 18.2, 20.5]},
  ],
  roofs: [
    {rect:[-0.25, -0.25, 23.25, 12.05], overhang:0.8},
    {rect:[15.7, 8.45, 19.3, 14.45], overhang:0.8},
  ],
  openings: [
    {kind:"slider", cx:10.2, cy:0, w:4.4, azimuth:180, exterior:true},
    {kind:"window", cx:15.3, cy:0, w:2.1, azimuth:180, exterior:true},
    {kind:"window", cx:17.725, cy:0, w:0.6, azimuth:180, exterior:true},
    {kind:"window", cx:20.9, cy:0, w:2.4, azimuth:180, exterior:true},
    {kind:"slider", cx:6.65, cy:3.5, w:2.9, azimuth:270, exterior:true},
    {kind:"window", cx:0, cy:8.6, w:1, azimuth:270, exterior:true},
    {kind:"garage", cx:3.4, cy:11.8, w:5, azimuth:0, exterior:true},
    {kind:"window", cx:11.25, cy:11.8, w:2.4, azimuth:0, exterior:true},
    {kind:"window", cx:14.35, cy:11.8, w:0.6, azimuth:0, exterior:true},
    {kind:"entry", cx:17.5, cy:11.8, w:1.2, azimuth:0, exterior:true},
    {kind:"window", cx:21.9, cy:11.8, w:1.2, azimuth:0, exterior:true},
    {kind:"window", cx:23, cy:1.9, w:1.2, azimuth:90, exterior:true},
    {kind:"window", cx:23, cy:7.25, w:0.8, azimuth:90, exterior:true},
    {kind:"window", cx:23, cy:10.1, w:1.2, azimuth:90, exterior:true},
  ],
};
