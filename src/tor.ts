import { app } from "@arkecosystem/core-container";
import { EventEmitter, Logger } from "@arkecosystem/core-interfaces";
import { ChildProcess, spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { IModule, IOptions } from "./interfaces";

export class Tor implements IModule {
    private readonly emitter: EventEmitter.EventEmitter = app.resolvePlugin<
        EventEmitter.EventEmitter
    >("event-emitter");
    private readonly logger: Logger.ILogger = app.resolvePlugin<Logger.ILogger>("logger");
    private readonly options: IOptions;
    private started: boolean = false;

    public constructor(options: IOptions) {
        this.options = options;
    }

    public async start(): Promise<void> {
        let torPath: string = this.options.tor.path;
        if (!torPath) {
            try {
                torPath = spawnSync("which", ["tor"], { shell: true })
                    .stdout.toString()
                    .trim();
            } catch (error) {
                //
            }
        }
        if (!torPath || !existsSync(torPath)) {
            this.logger.warn("Core Chameleon could not find Tor on the system");
            this.logger.warn("Your true IP address may still appear in the logs of other relays");
            return;
        }

        this.logger.info("Core Chameleon is starting Tor - this may take a while");
        this.killPid();

        try {
            await this.spawn(torPath);
            this.emitter.emit("Chameleon.P2P.TorReady");
        } catch (error) {
            this.logger.error(error);
        }
    }

    public async stop(): Promise<void> {
        if (this.started) {
            this.killPid();
        }
    }

    private killPid(): void {
        spawnSync("pkill", [`-f ${process.env.CORE_PATH_TEMP}/tor.conf`], {
            shell: true
        });
    }

    private async spawn(path: string): Promise<void> {
        return new Promise((resolve: (_: void) => void, reject: (error: string) => void): void => {
            try {
                let instances: number = 0;
                const maxInstances: number = this.options.tor.instances;
                for (let i: number = 0; i < maxInstances; i++) {
                    const directory: string = `${process.env.CORE_PATH_TEMP}/tor/${i}`;
                    if (!existsSync(directory)) {
                        mkdirSync(directory, { recursive: true, mode: 0o700 });
                    }
                    const configuration: string = `SocksPort unix:${directory}/socks.sock\nDataDirectory ${directory}`;
                    writeFileSync(`${directory}.conf`, configuration);
                    const torProcess: ChildProcess = spawn(
                        path,
                        [`-f ${directory}.conf`, "--runAsDaemon 0"],
                        {
                            shell: true
                        }
                    );
                    torProcess.stdout.setEncoding("utf8");
                    torProcess.stdout.on("data", (data: string) => {
                        if (data.indexOf("100%") > 0) {
                            instances++;
                            if (instances === maxInstances) {
                                this.logger.info("Core Chameleon successfully started Tor");
                                this.logger.info(
                                    "Your true IP address will not appear in the logs of other relays"
                                );
                                this.started = true;
                                resolve();
                            }
                        }
                    });
                    torProcess.on("exit", (): void => {
                        reject("Failed to start Tor");
                    });
                }
            } catch (error) {
                reject(`Failed to start Tor: ${error.message}`);
            }
        });
    }
}
