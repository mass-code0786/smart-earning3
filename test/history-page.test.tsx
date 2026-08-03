import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HistoryPage from "@/components/history-page";
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe("History Center UI",()=>{
 it("requests and renders the owner-relative Magic Level placement position",async()=>{
  const placement={
   id:"placement-1",type:"MAGIC_LEVEL_PLACED",category:"MAGIC_LEVEL",amount:null,currency:"USDT",
   sourceWallet:"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",packageAmount:null,packageId:null,
   matrixType:"MAGIC_LEVEL",cycle:null,recycleCount:null,status:"CONFIRMED",txHash:`0x${"cd".repeat(32)}`,
   createdAt:"2026-07-28T10:00:00Z",description:"Magic Level placement",incomeType:null,level:2,
   position:3,metadata:{memberId:"SE100001",reference:"registration:7"},
  };
  const fetchMock=vi.fn((input:string)=>Promise.resolve({
   ok:true,json:async()=>String(input).includes("category=MAGIC_LEVEL")?{items:[placement],nextCursor:null}:{items:[],nextCursor:null},
  }));
  vi.stubGlobal("fetch",fetchMock);render(<HistoryPage/>);
  fireEvent.click(screen.getByRole("button",{name:"Magic Level"}));
  expect(await screen.findByText("Magic Level placement")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([input])=>String(input).includes("category=MAGIC_LEVEL"))).toBe(true);
  expect(screen.getByText("SE100001")).toBeInTheDocument();
  expect(screen.getByText("registration:7")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Copy 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")).toBeInTheDocument();
 });
 it("shows the empty state when canonical Magic Level placements are absent",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({items:[],nextCursor:null})}));
  render(<HistoryPage/>);fireEvent.click(screen.getByRole("button",{name:"Magic Level"}));
  expect(await screen.findByText("No verified history records found.")).toBeInTheDocument();
 });
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
