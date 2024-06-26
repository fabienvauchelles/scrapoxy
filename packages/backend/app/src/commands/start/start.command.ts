import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import {
    DocumentBuilder,
    SwaggerModule,
} from '@nestjs/swagger';
import {
    CommanderScraperModule,
    DatacenterLocalApp,
    getEnvStorageDistributedModuleConfig,
    getEnvStorageType,
    LogExceptionFilter,
    ProxyLocalApp,
    ScrapoxyExpressAdapter,
    SUBSCRIPTION_LOCAL_DEFAULTS,
} from '@scrapoxy/backend-sdk';
import {
    capitalize,
    ONE_MINUTE_IN_MS,
} from '@scrapoxy/common';
import { sigstop } from '@scrapoxy/proxy-sdk';
import {
    Command,
    Option,
} from 'commander';
import * as compression from 'compression';
import {
    json,
    urlencoded,
} from 'express';
import { v4 as uuid } from 'uuid';
import { getEnvCommanderPort } from './start.helpers';
import { AppStartModule } from './start.module';
import type {
    IAppStartModuleConfig,
    IPackageInfo,
} from './start.interface';
import type { LoggerService } from '@nestjs/common';


async function command(
    config: IAppStartModuleConfig,
    loggerService: LoggerService
) {
    const logger = new Logger('StartCommand');

    // Update and check options
    config.storage = getEnvStorageType(config.storage);
    config.distributed = config.distributed ?? process.env.DISTRIBUTED_MODE ?? 'both';

    if (!config.standalone &&
        !config.master &&
        !config.commander &&
        !config.frontend &&
        !config.refreshAll &&
        !config.refreshConnectors &&
        !config.refreshFreeproxies &&
        !config.refreshMetrics &&
        !config.refreshProxies &&
        !config.refreshTasks
    ) {
        config.standalone = true;
    }

    if (config.standalone) {
        config.commander = true;
        config.frontend = true;
        config.master = true;
        config.refreshAll = true;

        if (!config.storage || config.storage.length <= 0) {
            config.storage = 'file'; // By default
        }
    }

    if (config.refreshAll) {
        config.refreshConnectors = true;
        config.refreshFreeproxies = true;
        config.refreshMetrics = true;
        config.refreshProxies = true;
        config.refreshTasks = true;
    }

    if (config.commander) {
        if (!config.storage || config.storage.length <= 0) {
            throw new Error('Storage type should be set if commander is enabled');
        }
    } else {
        if (config.test) {
            throw new Error('test connectors can only be used with commander and refresh on the same instance');
        }
    }

    // Start local datacenter and create a default project if needed
    let datacenterLocalApp: DatacenterLocalApp | undefined;
    let proxyLocalApp: ProxyLocalApp | undefined;

    if (config.test) {
        const filename = process.env.DATACENTER_LOCAL_FILENAME ?? 'datacenters-local.json';
        datacenterLocalApp = new DatacenterLocalApp(
            loggerService,
            filename
        );

        await datacenterLocalApp.start();

        config.datacenterLocalAppUrl = datacenterLocalApp.url;

        const subscriptions = await datacenterLocalApp.client.getAllSubscriptions();

        if (subscriptions.length <= 0) {
            await datacenterLocalApp.client.createSubscription({
                id: uuid(),
                ...SUBSCRIPTION_LOCAL_DEFAULTS,
            });
        }

        // Start local proxy
        const timeout = parseInt(
            process.env.MASTER_TIMEOUT ?? ONE_MINUTE_IN_MS.toString(10),
            10
        );
        proxyLocalApp = new ProxyLocalApp(
            loggerService,
            timeout,
            'proxy-local'
        );

        await proxyLocalApp.listen();

        config.proxyLocalAppUrl = proxyLocalApp.url;
    }

    // Start Scrapoxy
    const app = await NestFactory.create(
        AppStartModule.forRoot(config),
        new ScrapoxyExpressAdapter(),
        {
            logger: loggerService,
        }
    );
    app.enableShutdownHooks();
    app.useGlobalFilters(new LogExceptionFilter());
    app.use(json({
        limit: '50mb',
    }));
    app.use(urlencoded({
        extended: true, limit: '50mb',
    }));
    app.use(compression());

    if (config.storage === 'distributed') {
        const configStorage = getEnvStorageDistributedModuleConfig();

        if (config.distributed === 'write' || config.distributed === 'both') {
            // Receive items on the 'orders' queue with @EventPattern('...')
            app.connectMicroservice({
                transport: Transport.RMQ,
                options: {
                    urls: [
                        configStorage.rabbitmq.uri,
                    ],
                    queue: configStorage.rabbitmq.queueOrders,
                    queueOptions: {
                        durable: false,
                    },
                },
            });
        }

        if (config.distributed === 'read' || config.distributed === 'both') {
            // Receive items on the 'events' queue with @EventPattern(MESSAGE_EVENTS)
            app.connectMicroservice({
                transport: Transport.RMQ,
                options: {
                    urls: [
                        configStorage.rabbitmq.uri,
                    ],
                    queue: configStorage.rabbitmq.queueEvents,
                    queueOptions: {
                        durable: false,
                    },
                },
            });
        }

        await app.startAllMicroservices();
    }

    const swaggerConfig = new DocumentBuilder()
        .setTitle(capitalize(config.package.name))
        .setVersion(config.package.version)
        .setDescription(config.package.description)
        .addBasicAuth()
        .build();
    const document = SwaggerModule.createDocument(
        app,
        swaggerConfig,
        {
            include: [
                CommanderScraperModule,
            ],
        }
    );

    SwaggerModule.setup(
        'api',
        app,
        document
    );

    sigstop(() => {
        (async() => {
            await app.close();

            const promises: Promise<void>[] = [];

            if (datacenterLocalApp) {
                promises.push(datacenterLocalApp.close());
            }

            if (proxyLocalApp) {
                promises.push(proxyLocalApp.close());
            }

            await Promise.all(promises);
        })()
            .catch((err: any) => {
                console.error(err);
            });
    });

    const configRaw = JSON.stringify(
        config,
        void 0,
        2
    );
    logger.debug(`Start options are: ${configRaw}`);

    if (config.commander) {
        const commanderPort = getEnvCommanderPort();

        await app.listen(commanderPort);

        logger.log(`Commander is listening at port ${commanderPort}`);
    } else {
        await app.init();
    }
}


export function addCommand(
    program: Command,
    pkg: IPackageInfo,
    logger: LoggerService
) {
    program
        .command(
            'start',
            {
                isDefault: true,
            }
        )
        .description(`Start ${capitalize(pkg.name)}`)
        .addOption(new Option(
            '-s, --standalone',
            'Run as a standalone instance'
        ))
        .addOption(new Option(
            '-m, --master',
            'Run the Master module'
        ))
        .addOption(new Option(
            '-c, --commander',
            'Run the Commander module'
        ))
        .addOption(new Option(
            '-f, --frontend',
            'Serve the User Interface'
        ))
        .addOption(new Option(
            '-r, --refresh-all',
            'Run the all the Refresh modules'
        ))
        .addOption(new Option(
            '--refresh-connectors',
            'Run the Connectors refresh module'
        ))
        .addOption(new Option(
            '--refresh-freeproxies',
            'Run the Freeproxies refresh module'
        ))
        .addOption(new Option(
            '--refresh-metrics',
            'Run the Metrics refresh module'
        ))
        .addOption(new Option(
            '--refresh-proxies',
            'Run the Proxies refresh module'
        ))
        .addOption(new Option(
            '--refresh-tasks',
            'Run the Tasks refresh module'
        ))
        .addOption(new Option(
            '--storage <type>',
            'Choose storage'
        )
            .choices([
                'file', 'distributed', 'memory',
            ]))
        .addOption(new Option(
            '--distributed <mode>',
            'Choose distributed storage mode with --storage distributed'
        )
            .choices([
                'read', 'write', 'both',
            ]))
        .addOption(new Option(
            '--test',
            'Activate test connectors'
        ))
        .action((config: IAppStartModuleConfig) => {
            config.package = pkg;

            return command(
                config,
                logger
            );
        });
}
