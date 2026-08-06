import{NextRequest,NextResponse}from"next/server";
import{jwtVerify}from"jose";
import{isConfiguredAdmin}from"@/lib/server/admin-policy";

const SESSION_COOKIE="se_session",MAX_BODY_BYTES=1_048_576;
const protectedPrefixes=["/dashboard","/packages","/matrix","/team","/wallet","/booster","/autopool","/dividend","/income","/magic-level","/history","/menu","/admin"];
const buckets=new Map<string,{count:number;resetAt:number}>();

function securityHeaders(response:NextResponse){
 response.headers.set("Content-Security-Policy","default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:");
 response.headers.set("Referrer-Policy","strict-origin-when-cross-origin");
 response.headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=(), payment=()");
 response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("X-Frame-Options","DENY");
 response.headers.set("Cross-Origin-Opener-Policy","same-origin");response.headers.set("Cross-Origin-Resource-Policy","same-origin");
 if(process.env.NODE_ENV==="production")response.headers.set("Strict-Transport-Security","max-age=31536000; includeSubDomains; preload");
 return response;
}
function ratePolicy(pathname:string){if(pathname.startsWith("/api/auth/"))return{group:"auth",limit:30};if(pathname.startsWith("/api/registrations/"))return{group:"registration",limit:20};if(pathname.startsWith("/api/admin/"))return{group:"admin",limit:120};return null}
function rateLimited(request:NextRequest,pathname:string){const policy=ratePolicy(pathname);if(!policy)return false;const now=Date.now(),ip=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||request.headers.get("x-real-ip")||"unknown",key=`${policy.group}:${ip}`,current=buckets.get(key);if(!current||current.resetAt<=now){buckets.set(key,{count:1,resetAt:now+60_000});return false}current.count++;return current.count>policy.limit}
export function resetRateLimitsForTests(){buckets.clear()}

export async function proxy(request:NextRequest){
 const pathname=request.nextUrl.pathname,isApi=pathname.startsWith("/api/");
 if(isApi){
  const length=Number(request.headers.get("content-length")||0);if(Number.isFinite(length)&&length>MAX_BODY_BYTES)return securityHeaders(NextResponse.json({error:"Request body too large",code:"PAYLOAD_TOO_LARGE"},{status:413}));
  const origin=request.headers.get("origin"),allowed=process.env.APP_ORIGIN;if(origin&&allowed&&origin!==allowed)return securityHeaders(NextResponse.json({error:"Cross-origin request denied",code:"ORIGIN_DENIED"},{status:403}));
  if(rateLimited(request,pathname)){const response=NextResponse.json({error:"Too many requests",code:"RATE_LIMITED"},{status:429});response.headers.set("Retry-After","60");return securityHeaders(response)}
 }
 if(!protectedPrefixes.some(prefix=>pathname===prefix||pathname.startsWith(`${prefix}/`)))return securityHeaders(NextResponse.next());
 const token=request.cookies.get(SESSION_COOKIE)?.value,secret=process.env.SESSION_SECRET;
 if(token&&secret){try{const{payload}=await jwtVerify(token,new TextEncoder().encode(secret),{algorithms:["HS256"]});if((pathname==="/admin"||pathname.startsWith("/admin/"))&&!isConfiguredAdmin(String(payload.sub||"")))throw new Error("Admin required");return securityHeaders(NextResponse.next())}catch{}}
 const response=NextResponse.redirect(new URL("/",request.url));if(token)response.cookies.delete(SESSION_COOKIE);return securityHeaders(response);
}

export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|logo.png).*)"]};
