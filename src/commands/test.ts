import fs from "fs";
import path from "path";

export default async function testCommand() {
    console.log("Running tests for Move smart contracts...");

    const testDir = path.join(process.cwd(), "tests");

    if (!fs.existsSync(testDir)) {
        console.error("No tests directory found. Please create a 'tests' directory with your test files.");
        return;
    }

    const testFiles = fs.readdirSync(testDir).filter(file => file.endsWith(".move"));

    if (testFiles.length === 0) {
        console.error("No Move test files found in the 'tests' directory.");
        return;
    }

    for (const file of testFiles) {
        console.log(`Executing test file: ${file}`);
        // Aquí puedes agregar la lógica para ejecutar cada archivo de prueba Move
        // Por ejemplo, podrías usar un comando CLI específico para ejecutar las pruebas
        await import(path.join(testDir, file));
    }

    console.log("All tests executed.");
}