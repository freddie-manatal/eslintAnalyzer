#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { stringify } = require('csv-stringify/sync');
const inquirer = require('inquirer');
const inquirerFuzzyPath = require('inquirer-fuzzy-path');

// Register the fuzzy-path prompt
inquirer.registerPrompt('fuzzy-path', inquirerFuzzyPath);

// Recursively find all .js and .vue files in a directory, excluding node_modules
function findFiles(dir, ext = ['.js', '.jsx', '.ts', '.vue'], fileList = []) {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            if (file !== 'node_modules') { // Exclude node_modules directory
                findFiles(filePath, ext, fileList);
            }
        } else if (ext.includes(path.extname(file))) {
            fileList.push(filePath);
        }
    });
    return fileList;
}

// Analyze file content for `eslint-disable-next-line` rules
async function analyzeFile(filePath) {
    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        output: process.stdout,
        terminal: false
    });

    const ruleOccurrences = []; // Array to store rule occurrences with line numbers
    let lineNumber = 0; // Initialize a line number counter

    rl.on('line', (line) => {
        lineNumber++; // Increment the line number counter for each line read
        const nextLineMatch = line.match(/eslint-disable-next-line ([^\s]+)/);
        const disableMatch = line.match(/eslint-disable ([^\s]+)/);
        
        if (nextLineMatch) {
            ruleOccurrences.push({ rule: nextLineMatch[1], line: lineNumber }); // Store rule and line number
        } else if (disableMatch) {
            ruleOccurrences.push({ rule: disableMatch[1], line: lineNumber }); // Store rule and line number
        }
    });

    return new Promise((resolve) => {
        rl.on('close', () => {
            resolve(ruleOccurrences);
        });
    });
}

// Generate the report
async function generateReport(directory) {
    const files = findFiles(directory);
    const rulesCount = {};
    const fileDetails = [];

    for (const file of files) {
        const occurrences = await analyzeFile(file);
        if (occurrences.length > 0) {
            const ruleDetails = occurrences.map(o => `${o.rule} (Line ${o.line})`).join(', ');
            fileDetails.push([path.basename(file), file, ruleDetails]);
            occurrences.forEach(({ rule }) => {
                rulesCount[rule] = (rulesCount[rule] || 0) + 1;
            });
        }
    }

    return { rulesCount, fileDetails };
}

// Prompt for directory selection
async function promptForDirectory() {
    const answers = await inquirer.prompt([
        {
            type: 'fuzzy-path',
            name: 'directory',
            itemType: 'directory',
            rootPath: './',
            message: 'Select the directory to analyze:',
            suggestOnly: false,
            depthLimit: 5
        }
    ]);

    return answers.directory;
}

// Prompt for save location with autocomplete
async function promptForSaveLocation() {
    const answers = await inquirer.prompt([
        {
            type: 'fuzzy-path',
            name: 'saveLocation',
            itemType: 'directory',
            rootPath: './',
            message: 'Enter the directory where you want to save the reports:',
            suggestOnly: true,
            depthLimit: 5,
            enableGoUpperDirectory: true, // Enable suggestion for `../`
            suggestChoice: () => true // Suggest all choices
        }
    ]);

    return path.resolve(answers.saveLocation);
}

// Execute the report generation
(async function main() {
    try {
        const directoryToAnalyze = await promptForDirectory();
        const { rulesCount, fileDetails } = await generateReport(directoryToAnalyze);

        // Prompt the user for the save location after the analysis is complete
        const saveLocation = await promptForSaveLocation();

        const rulesCountCsv = stringify(Object.entries(rulesCount), { header: true, columns: ['Rule', 'Count'] });
        const fileDetailsCsv = stringify(fileDetails, { header: true, columns: ['Filename', 'Filepath', 'Applied Rules'] });

        const rulesCountPath = path.join(saveLocation, 'rules_count_report.csv');
        const fileDetailsPath = path.join(saveLocation, 'file_details_report.csv');

        fs.writeFileSync(rulesCountPath, rulesCountCsv);
        fs.writeFileSync(fileDetailsPath, fileDetailsCsv);

        console.log(`Reports generated at ${saveLocation}:`);
        console.log(`- ${rulesCountPath}`);
        console.log(`- ${fileDetailsPath}`);
    } catch (error) {
        console.error('Error:', error);
    }
})();
