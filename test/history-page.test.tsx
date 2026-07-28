import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HistoryPage from "@/components/history-page";
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe("History Center UI",()=>{
 it("renders verified records and sends mobile filters to the API",async()=>{
  const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({items:[{
   id:"x3-recycle:1",type:"X3_RECYCLE",category:"MATRIX",amount:null,currency:null,
   sourceWallet:null,packageAmount:"16.00",packageId:2,matrixType:"X3",cycle:3,recycleCount:2,
   status:"COMPLETED",txHash:`0x${"ab".repeat(32)}`,createdAt:"2026-07-28T10:00:00Z",
   description:"X3 package 2 recycled",incomeType:null,level:null,position:null,metadata:{},
  }],nextCursor:null})});
  vi.stubGlobal("fetch",fetchMock);render(<HistoryPage/>);
  expect(await screen.findByText("X3 package 2 recycled")).toBeInTheDocument();
  expect(screen.getByText("2 times ♻️")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Filters"}));
  fireEvent.change(screen.getByPlaceholderText("0x source wallet"),{target:{value:"0xabc"}});
  fireEvent.click(screen.getByRole("button",{name:"Apply Filters"}));
  await waitFor(()=>expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("sourceWallet=0xabc"));
 });
});
