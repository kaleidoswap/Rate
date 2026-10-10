export const skillsFromBundle=(bundle:any)=>bundle.skills.map((s:any)=>({name:s.dir,description:s.markdown.match(/description: *["']?([^\n]+)/)?.[1]?.replace(/["']$/, '')||''}));
