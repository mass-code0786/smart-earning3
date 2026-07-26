import{SmartEarningPageShell}from'@/components/smart-earning-shell';import{AdminPanel}from'@/components/admin-panel';
import{PackageAdminPanel}from'@/components/package-admin-panel';
import{X3AdminPanel}from'@/components/x3-admin-panel';
import{X4AdminPanel}from'@/components/x4-admin-panel';
import{BoosterAdminPanel}from'@/components/booster-admin-panel';
import{AutopoolAdminPanel}from'@/components/autopool-admin-panel';
import{DividendAdminPanel}from'@/components/dividend-admin-panel';
import{OperationsAdminPanel}from'@/components/operations-admin-panel';
export default function Page(){return <SmartEarningPageShell><div className="mb-4"><p className="info-eyebrow">ADMINISTRATION</p><h1 className="text-2xl font-bold">Smart Earning Operations</h1></div><OperationsAdminPanel/><AdminPanel/><PackageAdminPanel/><X3AdminPanel/><X4AdminPanel/><BoosterAdminPanel/><AutopoolAdminPanel/><DividendAdminPanel/></SmartEarningPageShell>}
