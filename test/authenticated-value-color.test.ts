// @vitest-environment node
import{readFileSync}from"node:fs";
import{resolve}from"node:path";
import{describe,expect,it}from"vitest";

const css=readFileSync(resolve("app/dashboard.css"),"utf8");

describe("authenticated value color normalization",()=>{
 it("defines one authenticated-only pure-white value token",()=>{
    expect(css).toContain(".smart-internal-shell{--se-value-color:#FFFFFF}");
  expect(css).toContain("color:var(--se-value-color)!important");
 });
 it("covers shared income, wallet, home, history and semantic amount selectors",()=>{
  for(const selector of[
   'b[class*="text-[#00f77a]"]',".transaction-result>b.is-credit",
   ".income-type-card b",".income-history-items article b",".wallet-summary>b",
   ".wallet-history-list>button>span:nth-child(3) b",".history-record-grid b.positive",
  ])expect(css).toContain(selector);
 });
 it("does not recolor green icon, button, link, status or countdown selectors",()=>{
  const rule=css.slice(css.indexOf("/* Authenticated monetary/numeric values only"));
  for(const selector of[
   ".income-icon",".wallet-history-icon",".team-status-active",".income-status",
   ".history-apply",".team-action-button",".home-action-timer.available",
  ])expect(rule).not.toContain(selector);
 });
});
