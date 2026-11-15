// Cedwyn Wales 3D timelapse ElevenLabs v3 neural narration endpoint.
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
const VOICE_ID = "6WwXjDDEMyNmFG95zycZ";
const MODEL = "elevenlabs/eleven-v3";
const ALLOWED_ORIGINS = new Set([
  "https://feature-timelapse-1877-prese.cedwyn-wales-3d.pages.dev",
  "https://cedwyn-wales-3d.pages.dev"
]);
function headers(origin, extra={}) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Type, Content-Length, X-Cedwyn-Voice, X-TTS-State",
    "Cache-Control": "public, max-age=3600",
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
      return json({ok:true,model:MODEL,voice:"Eldrin · Crisp British Baritone",voice_id:VOICE_ID,ai_binding:!!env.AI,mode:"GET audio URL; play() can be started directly in a tap"},200,origin);
    }
    if(!["GET","HEAD","POST"].includes(request.method)||url.pathname!=="/speak") return new Response("Not found",{status:404});
    let id=url.searchParams.get("id")||"";
    if(request.method==="POST") {
      try { const b=await request.json(); id=typeof b.id==="string"?b.id:id; }
      catch { return json({error:"Invalid JSON"},400,origin); }
    }
    const text=EVENT_TITLES[id];
    if(!text) return json({error:"Unknown event ID",received:id,valid:Object.keys(EVENT_TITLES)},404,origin);
    const cacheKey=new Request("https://cedwyn-voice-cache.invalid/v2/"+encodeURIComponent(id)+"?voice=eldrin-v3");
    const cached=await caches.default.match(cacheKey);
    if(cached) {
      const h=new Headers(cached.headers); h.set("Access-Control-Allow-Origin",origin||"*");
      return new Response(cached.body,{status:cached.status,headers:h});
    }
    try {
      const output=await env.AI.run(MODEL,{
        text,
        voice_id:VOICE_ID,
        output_format:"mp3_44100_128",
        language_code:"en"
      });
      const audio=(output&&output.result&&output.result.audio)||(output&&output.audio);
      if(typeof audio!=="string"||!audio) {
        console.error("ElevenLabs response without audio",JSON.stringify(output).slice(0,1200));
        return json({error:"ElevenLabs did not return an audio URL",state:output&&output.state||"unknown"},502,origin);
      }
      let response;
      if(audio.startsWith("data:")) {
        const comma=audio.indexOf(",");
        if(comma<0) throw new Error("Invalid data URI returned by TTS");
        const bytes=Uint8Array.from(atob(audio.slice(comma+1)),c=>c.charCodeAt(0));
        response=new Response(bytes,{status:200,headers:headers(origin,{"Content-Type":"audio/mpeg","Content-Length":String(bytes.byteLength),"X-Cedwyn-Voice":"Eldrin","X-TTS-State":"Completed"})});
      } else {
        const audioUrl=new URL(audio);
        if(audioUrl.protocol!=="https:") throw new Error("Unexpected non-HTTPS audio URL");
        response=new Response(null,{status:302,headers:headers(origin,{"Location":audioUrl.href,"X-Cedwyn-Voice":"Eldrin","X-TTS-State":output.state||"Completed"})});
      }
      ctx.waitUntil(caches.default.put(cacheKey,response.clone()));
      if(request.method==="HEAD") return new Response(null,{status:response.status,headers:response.headers});
      return response;
    } catch(error) {
      console.error("ElevenLabs v3 narration failed",error);
      return json({error:String(error&&error.message||error),model:MODEL,voice_id:VOICE_ID},502,origin);
    }
  }
};
