export const config = { runtime: "edge" };
const CORS = { "Content-Type":"application/json","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type" };
export default async function handler(req) {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  if (req.method!=="POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:CORS});
  let body; try { body=await req.json(); } catch { return new Response(JSON.stringify({error:"Invalid JSON"}),{status:400,headers:CORS}); }
  const { key } = body;
  if (!key?.trim()) return new Response(JSON.stringify({valid:false,error:"No key provided"}),{status:400,headers:CORS});
  const PRODUCT_ID = process.env.GUMROAD_PRODUCT_ID;
  if (!PRODUCT_ID) return new Response(JSON.stringify({valid:false,error:"Server config error"}),{status:500,headers:CORS});
  try {
    const res = await fetch("https://api.gumroad.com/v2/licenses/verify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({product_id:PRODUCT_ID,license_key:key.trim().toUpperCase(),increment_uses_count:"false"})});
    const data = await res.json();
    if (data.success) return new Response(JSON.stringify({valid:true}),{headers:CORS});
    return new Response(JSON.stringify({valid:false,error:data.message||"Invalid licence key."}),{headers:CORS});
  } catch {
    return new Response(JSON.stringify({valid:false,error:"Validation service unavailable."}),{status:502,headers:CORS});
  }
}
