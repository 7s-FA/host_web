const fs=require('node:fs');
const sim=require('../engine.js');

const stagesFor=sim.stagesFor;
if(require.main===module){
 const scenarios=Object.fromEntries([1,2].map(quantity=>[quantity,stagesFor(quantity)]));
 fs.writeFileSync(require('node:path').join(__dirname,'scenarios.json'),JSON.stringify(scenarios));
 fs.writeFileSync(require('node:path').join(__dirname,'scenario-config.json'),JSON.stringify(require('../settings.js').defaults,null,2)+'\n');
}
module.exports={stagesFor};
