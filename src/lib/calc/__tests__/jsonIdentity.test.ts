// The browser bundle of the Energy and Budget pages carries no validator: the model, the assumptions and the price book are used as
// imported JSON (type assertions in model/instance.ts, energy.ts, budgetCore.ts). That is safe only while the schemas leave the
// files unchanged (no defaults, no transforms, no stripped keys), which this test pins; it also validates the three files.
import { describe, expect, it } from "vitest";
import assumptionsJson from "@model/assumptions.json";
import houseJson from "@model/house.json";
import pricebookJson from "@model/pricebook.json";
import { defaultPricebook } from "../budgetCore";
import { PricebookSchema } from "../budgetSchema";
import { defaultEnergyContext } from "../energy";
import { AssumptionsSchema } from "../energySchema";
import { house } from "@/lib/model/instance";
import { HouseSchema } from "@/lib/model/schema";

describe("model data files are used as they are", () => {
  it("house.json: parsing changes nothing", () => {
    expect(HouseSchema.parse(houseJson)).toStrictEqual(houseJson);
    expect(house).toBe(houseJson);
  });
  it("assumptions.json: parsing changes nothing", () => {
    expect(AssumptionsSchema.parse(assumptionsJson)).toStrictEqual(assumptionsJson);
    expect(defaultEnergyContext().assumptions).toBe(assumptionsJson);
  });
  it("pricebook.json: parsing changes nothing", () => {
    expect(PricebookSchema.parse(pricebookJson)).toStrictEqual(pricebookJson);
    expect(defaultPricebook()).toBe(pricebookJson);
  });
});
