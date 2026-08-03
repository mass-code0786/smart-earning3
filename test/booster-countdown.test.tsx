import{act,cleanup,render,screen}from"@testing-library/react";
import{afterEach,beforeEach,describe,expect,it,vi}from"vitest";
import{BoosterCountdown,synchronizedRemaining}from"@/components/booster-countdown";

describe("Booster synchronized countdown",()=>{
 beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-01-01T12:00:00Z"))});
 afterEach(()=>{cleanup();vi.useRealTimers()});
 it("shows the correct server-synchronized initial value despite client clock difference",()=>{
  expect(synchronizedRemaining("2026-01-01T09:05:00Z","2026-01-01T09:00:00Z",0)).toBe(300_000);
  render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt="2026-01-01T09:05:00Z" eligibility="NOT_DUE" onRefresh={vi.fn()}/>);
  expect(screen.getByLabelText("Next Booster Entry countdown")).toHaveTextContent("00:05:00");
 });
 it("decreases from the synchronized target rather than a decrementing counter",()=>{
  render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt="2026-01-01T09:05:00Z" eligibility="NOT_DUE" onRefresh={vi.fn()}/>);
  act(()=>vi.advanceTimersByTime(2_000));
  expect(screen.getByLabelText("Next Booster Entry countdown")).toHaveTextContent("00:04:58");
 });
 it("renders less than one minute with leading zeroes",()=>{
  render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt="2026-01-01T09:00:30Z" eligibility="NOT_DUE" onRefresh={vi.fn()}/>);
  expect(screen.getByLabelText("Next Booster Entry countdown")).toHaveTextContent("00:00:30");
 });
 it("resumes correctly when fresh server values are loaded after a page refresh",()=>{
  const{unmount}=render(<BoosterCountdown serverTime="2026-01-01T09:02:00Z" nextEntryAt="2026-01-01T09:05:00Z" eligibility="NOT_DUE" onRefresh={vi.fn()}/>);
  expect(screen.getByText("00:03:00")).toBeInTheDocument();unmount();
  render(<BoosterCountdown serverTime="2026-01-01T09:04:00Z" nextEntryAt="2026-01-01T09:05:00Z" eligibility="NOT_DUE" onRefresh={vi.fn()}/>);
  expect(screen.getByText("00:01:00")).toBeInTheDocument();
 });
 it("shows Processing and polls without changing wallet or entry data in the browser",async()=>{
  const refresh=vi.fn().mockResolvedValue(undefined);
  render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt="2026-01-01T09:00:01Z" eligibility="NOT_DUE" onRefresh={refresh} pollMilliseconds={5_000}/>);
  await act(async()=>vi.advanceTimersByTime(1_000));
  expect(screen.getByText("Booster Available")).toBeInTheDocument();
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTime(5_000));
  expect(refresh).toHaveBeenCalledTimes(2);
 });
 it("starts a new four-hour countdown when refreshed server data confirms an entry",async()=>{
  const refresh=vi.fn().mockResolvedValue(undefined);
  const{rerender}=render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt="2026-01-01T09:00:00Z" eligibility="DUE" onRefresh={refresh}/>);
  expect(screen.getByText("Booster Available")).toBeInTheDocument();
  rerender(<BoosterCountdown serverTime="2026-01-01T09:00:10Z" nextEntryAt="2026-01-01T13:00:10Z" eligibility="ENTRY_CREATED" onRefresh={refresh}/>);
  expect(screen.getByText("04:00:00")).toBeInTheDocument();
 });
 it("shows the persisted inactive state without constructing a timer",()=>{
  render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt={null} eligibility="INACTIVE" onRefresh={vi.fn()}/>);
  expect(screen.getByText("Booster inactive")).toBeInTheDocument();
  expect(screen.queryByLabelText("Next Booster Entry countdown")).not.toBeInTheDocument();
 });
 it("continues the canonical countdown when the Booster Wallet balance is insufficient",()=>{
  render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt="2026-01-01T13:00:00Z" eligibility="INSUFFICIENT_BALANCE" onRefresh={vi.fn()}/>);
  expect(screen.getByLabelText("Next Booster Entry countdown")).toHaveTextContent("04:00:00");
  expect(screen.queryByText("Insufficient Booster Wallet balance")).not.toBeInTheDocument();
 });
 it("resynchronizes with the server when the tab becomes visible",async()=>{
  const refresh=vi.fn().mockResolvedValue(undefined);
  render(<BoosterCountdown serverTime="2026-01-01T09:00:00Z" nextEntryAt="2026-01-01T10:00:00Z" eligibility="NOT_DUE" onRefresh={refresh}/>);
  Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});
  await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
  expect(refresh).toHaveBeenCalledTimes(1);
 });
});
