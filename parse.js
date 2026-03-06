const fs = require('fs');
const data = JSON.parse(fs.readFileSync('eslint-report.json', 'utf-8'));
data.filter(f => f.errorCount > 0).forEach(f => {
    console.log('\nFILE: ' + f.filePath);
    f.messages.forEach(m => console.log(`  Line ${m.line}: ${m.message} (${m.ruleId})`));
});
