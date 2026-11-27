// Cedwyn Wales 3D timelapse Deepgram Aura Helios narration endpoint.
const EVENT_TITLES = {
  "e1535":"1535 · Tewkesbury Abbey and the manorial lordship",
  "e1543":"1543 · the Crown grants the manorial interest",
  "e1545":"1545 · Sir George Herbert and the Llandough manor",
  "e1547":"1547 · a separate Herbert–Vaughan lease is recorded",
  "e1667":"1667 · the Williams family at Tŷ Mawr",
  "e1767":"By 1767 · the manor passes to Hurst and Jones",
  "e1793":"1793 · the Earl of Bute acquires the manorial lordship",
  "e1824":"1824 · plan 19 names Cedfin or Ty Mawr Farm",
  "e1841":"1841 · John Williams occupies 36 parcels across Llandough and Leckwith",
  "e1877":"1877 · the farm is divided into Parcel A and Parcel B",
  "e1916":"1916 · a Bute yearly agricultural tenancy to the Williams family",
  "e1926":"1926 · the remaining Bute estate is reorganised as Mountjoy Limited",
  "e1928":"1928 · the last rent receipt and the family's freehold case for Parcel A",
  "e1938":"1938 · Parcel B is conveyed to Western Ground Rents",
  "e1939":"1939 · Western Ground Rents lets Parcel B to John Williams",
  "e1942":"1942 · about 110 acres of Leckwith Woods are gifted to Cardiff Corporation",
  "e1949":"1949 · Frederick Buckler takes over the yearly tenancy",
  "e1955":"1955 · possession is taken of the farm, except the farmhouse and garden",
  "e1959":"1959 · Mary Williams refuses the offer of a tenancy",
  "e1961":"1961 · a WGR, brick-and-tile and Cardiff Corporation deed is recorded against the woodland title",
  "e1962":"1962 · a possession order covers the farmhouse, buildings and garden",
  "e1965":"1965 · a further weekly letting is offered to Mrs Buckler",
  "e1969":"1969 · Western Ground Rents conveys Parcel B to BP Pension Trust",
  "e1970":"1970 · the separate green is registered as village green VG41",
  "e1974":"1974 · BP's licence letters and the legal character of occupation",
  "e1982":"1982 · BP Properties applies to register Parcel B",
  "e1983":"1983 · BP Properties is first registered for the house parcel",
  "e1987m":"1987 · the house and fields titles are amalgamated",
  "e1987":"1987 · the Court of Appeal decides BP Properties v Buckler",
  "e1988":"1988 · possession is taken and Great House Farm is demolished",
  "e1988s":"1988 · a wider BP portfolio sale does not include the Great House site",
  "e1988l":"1988 · the Land Authority for Wales acquires other Llandough plots",
  "e1993":"1993–94 · the house parcel and fields move to Ideal Homes",
  "e1994b":"1994–96 · Church View Close replaces the farmhouse and fields",
  "e1994":"1994 · the north woodland is registered to Forest of Cardiff",
  "e1995":"1995 · individual homes at Church View Close are sold",
  "e1996p":"1996 · Persimmon acquires Ideal Homes as a company",
  "e1996h":"1996 · the last Church View Close house is sold",
  "e2005":"2005 · part of the north woodland is sold to Goldsworthy Homes",
  "now":"Today · several parcel and interest questions remain open"
};
const MODEL = "@cf/deepgram/aura-1";
const SPEAKER = "helios";
const ALLOWED_ORIGINS = new Set([
  "https://feature-timelapse-1877-prese.cedwyn-wales-3d.pages.dev",
  "https://cedwyn-wales-3d.pages.dev",
  "https://bucklerfamily.estate",
  "https://www.bucklerfamily.estate"
]);
function headers(origin, extra={}) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Type, Content-Length, X-Cedwyn-Voice, X-TTS-Model",
    "Cache-Control": "public, max-age=31536000",
    "Vary": "Origin",
    ...extra
  };
}
function json(data,status,origin) {
  return Response.json(data,{status,headers:headers(origin,{"Cache-Control":"no-store"})});
}
export default {
  async fetch(request, env, ctx) {
    const origin=request.headers.get("Origin")||"";
    if(origin&&!ALLOWED_ORIGINS.has(origin)) return new Response("Forbidden",{status:403});
    const url=new URL(request.url);
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:headers(origin)});
    if(request.method==="GET"&&url.pathname==="/health") {
      return json({
        ok:true,
        model:MODEL,
        voice:"Helios · male · British / UK English",
        speaker:SPEAKER,
        ai_binding:!!env.AI,
        mode:"Cloudflare Workers AI audio response; directly playable from a tap"
      },200,origin);
    }
    if(!["GET","HEAD","POST"].includes(request.method)||url.pathname!=="/speak") return new Response("Not found",{status:404});
    let id=url.searchParams.get("id")||"";
    if(request.method==="POST") {
      try { const b=await request.json(); id=typeof b.id==="string"?b.id:id; }
      catch { return json({error:"Invalid JSON"},400,origin); }
    }
    const headline=EVENT_TITLES[id];
    if(!headline) return json({error:"Unknown event ID",received:id,valid:Object.keys(EVENT_TITLES)},404,origin);
    const suppliedYear=(url.searchParams.get("year")||"").slice(0,12);
    const suppliedTitle=(url.searchParams.get("title")||"").replace(/[\r\n\t]+/g," ").trim().slice(0,180);
    const suppliedSummary=(url.searchParams.get("summary")||"").replace(/[\r\n\t]+/g," ").trim().slice(0,360);
    const title=suppliedTitle || headline.replace(/^(?:By\s+)?\d{4}(?:[–-]\d{2,4})?\s*·\s*/, "");
    const year=suppliedYear || (headline.match(/^\d{4}/)||["Today"])[0];
    const narration=[year,title,suppliedSummary].filter(Boolean).join(". ");
    const text=narration.replace(/(\d)–(\d)/g,"$1 to $2").replace(/\bWGR\b/g,"W G R").replace(/\bBP\b/g,"B P");
    const cacheKey=new Request("https://cedwyn-voice-cache.invalid/v5/"+encodeURIComponent(id)+"?model=aura1-helios");
    const cached=await caches.default.match(cacheKey);
    if(cached) {
      const h=new Headers(cached.headers); h.set("Access-Control-Allow-Origin",origin||"*");
      return new Response(cached.body,{status:cached.status,headers:h});
    }
    try {
      const result=await env.AI.run(MODEL,{
        text,
        speaker:SPEAKER,
        encoding:"mp3"
      },{returnRawResponse:true});
      if(!(result instanceof Response)) throw new Error("Workers AI did not return a raw audio Response");
      if(!result.ok) {
        const detail=(await result.clone().text()).slice(0,1200);
        console.error("Deepgram Aura TTS error",result.status,detail);
        return json({error:"Workers AI TTS failed",status:result.status,detail},502,origin);
      }
      const contentType=result.headers.get("Content-Type")||"audio/mpeg";
      if(!contentType.includes("audio")) {
        const detail=(await result.clone().text()).slice(0,1200);
        console.error("Deepgram Aura returned non-audio",contentType,detail);
        return json({error:"TTS response was not audio",contentType,detail},502,origin);
      }
      const response=new Response(result.body,{
        status:200,
        headers:headers(origin,{
          "Content-Type":contentType,
          "X-Cedwyn-Voice":"Helios · British male",
          "X-TTS-Model":MODEL
        })
      });
      ctx.waitUntil(caches.default.put(cacheKey,response.clone()));
      if(request.method==="HEAD") return new Response(null,{status:200,headers:response.headers});
      return response;
    } catch(error) {
      console.error("Deepgram Aura narration failed",error);
      return json({error:String(error&&error.message||error),model:MODEL,speaker:SPEAKER},502,origin);
    }
  }
};