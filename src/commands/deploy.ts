import config from "../movehat.config.js";
import { exec } from "child_process";

export default function deployCommand() { 
    console.log("Deploying Move smart contracts...");

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