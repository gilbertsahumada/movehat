import { exec } from "child_process";
import { loadUserConfig } from "../helpers/config.js";

export default async function deployCommand() { 
    console.log("Deploying Move smart contracts...");

    const config = await loadUserConfig();

    exec(
        `movement move publish --profile ${config.profile} --package-dir ${config.moveDir} --assume-yes`,
        { cwd: config.moveDir },
        (error, stdout, stderr) => {
            if (error) {
                console.error(`Error during deployment: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`Deployment stderr: ${stderr}`);
                return;
            }
            console.log(`Deployment successful:\n${stdout}`);
        }
    )
}