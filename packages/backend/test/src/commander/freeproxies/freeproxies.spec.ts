import { Logger } from '@nestjs/common';
import { ConnectorFreeproxiesModule } from '@scrapoxy/backend-connectors';
import { ProxyHttp } from '@scrapoxy/backend-sdk';
import {
    CommanderApp,
    MasterApp,
    TestServers,
    waitFor,
} from '@scrapoxy/backend-test-sdk';
import {
    CONNECTOR_FREEPROXIES_TYPE,
    countProxiesOnlineViews,
    EProxyType,
    EventsFreeproxiesClient,
    IConnectorFreeproxyConfig,
    ISourcesAndFreeproxies,
    ONE_MINUTE_IN_MS,
    ONE_SECOND_IN_MS,
    PROXY_TIMEOUT_DISCONNECTED_DEFAULT_TEST,
    PROXY_TIMEOUT_UNREACHABLE_DEFAULT,
} from '@scrapoxy/common';
import axios from 'axios';
import type {
    IConnectorView,
    ICredentialView,
    IProjectData,
} from '@scrapoxy/common';


describe(
    'Commander - Freeproxies',
    () => {
        const logger = new Logger();
        const
            instance = axios.create({
                validateStatus: () => true,
            }),
            proxy = new ProxyHttp(
                logger,
                ONE_MINUTE_IN_MS
            ),
            servers = new TestServers();
        let
            client: EventsFreeproxiesClient,
            commanderApp: CommanderApp,
            connector: IConnectorView,
            credential: ICredentialView,
            masterApp: MasterApp,
            project: IProjectData,
            sourcesAndFreeproxies: ISourcesAndFreeproxies,
            token: string;

        beforeAll(async() => {
            // Start target and proxy
            await Promise.all([
                servers.listen(), proxy.listen(),
            ]);

            // Start app
            commanderApp = CommanderApp.defaults({
                fingerprintUrl: servers.urlFingerprint,
                imports: [
                    ConnectorFreeproxiesModule,
                ],
                logger,
            });
            await commanderApp.start();

            client = new EventsFreeproxiesClient(commanderApp.events);

            masterApp = MasterApp.defaults({
                commanderApp,
                fingerprintUrl: servers.urlFingerprint,
                imports: [
                    ConnectorFreeproxiesModule,
                ],
                logger,
            });
            await masterApp.start();

            // Create project
            project = await commanderApp.frontendClient.createProject({
                name: 'myproject',
                autoRotate: {
                    enabled: true,
                    min: ONE_MINUTE_IN_MS * 30,
                    max: ONE_MINUTE_IN_MS * 30,
                },
                autoScaleUp: true,
                autoScaleDown: {
                    enabled: true,
                    value: ONE_MINUTE_IN_MS,
                },
                cookieSession: true,
                mitm: true,
                proxiesMin: 1,
                useragentOverride: false,
                ciphersShuffle: false,
            });

            // Create credential
            credential = await commanderApp.frontendClient.createCredential(
                project.id,
                {
                    name: 'mycredential',
                    type: CONNECTOR_FREEPROXIES_TYPE,
                    config: {},
                }
            );

            await waitFor(async() => {
                await commanderApp.frontendClient.getCredentialById(
                    project.id,
                    credential.id
                );

                token = await commanderApp.frontendClient.getProjectTokenById(project.id);
            });

            // Create connector
            connector = await commanderApp.frontendClient.createConnector(
                project.id,
                {
                    name: 'myconnector',
                    proxiesMax: 1,
                    proxiesTimeoutDisconnected: PROXY_TIMEOUT_DISCONNECTED_DEFAULT_TEST,
                    proxiesTimeoutUnreachable: {
                        enabled: true,
                        value: PROXY_TIMEOUT_UNREACHABLE_DEFAULT,
                    },
                    credentialId: credential.id,
                    config: {
                        freeproxiesTimeoutDisconnected: PROXY_TIMEOUT_DISCONNECTED_DEFAULT_TEST + 1,
                        freeproxiesTimeoutUnreachable: {
                            enabled: false,
                            value: 3000,
                        },
                    },
                    certificateDurationInMs: 10 * ONE_MINUTE_IN_MS,
                }
            );

            await waitFor(async() => {
                await commanderApp.frontendClient.getConnectorById(
                    project.id,
                    connector.id
                );
            });

            // Connect events
            await client.subscribeAsync(
                project.id,
                connector.id,
                {
                    sources: [],
                    freeproxies: [],
                }
            );
        });

        afterAll(async() => {
            // Disconnect events
            await client.unsubscribeAsync();

            await commanderApp.stop();

            await Promise.all([
                masterApp.stop(), proxy.close(), servers.close(),
            ]);
        });

        it(
            'should add a proxy in freeproxies list',
            async() => {
                await commanderApp.frontendClient.createFreeproxies(
                    project.id,
                    connector.id,
                    [
                        {
                            type: EProxyType.HTTP,
                            key: `localhost:${proxy.port}`,
                            address: {
                                hostname: 'localhost',
                                port: proxy.port as number,
                            },
                            auth: null,
                        },
                    ]
                );
            }
        );

        it(
            'should have one proxy online in freeproxies list',
            async() => {
                await waitFor(() => {
                    expect(client.freeproxies)
                        .toHaveLength(1);

                    const freeproxy = client.freeproxies[ 0 ];
                    expect(freeproxy.type)
                        .toBe(EProxyType.HTTP);
                    expect(freeproxy.key)
                        .toBe(`localhost:${proxy.port}`);
                    expect(freeproxy.address)
                        .toEqual({
                            hostname: 'localhost',
                            port: proxy.port,
                        });
                    expect(freeproxy.auth)
                        .toBeNull();
                    expect(freeproxy.fingerprint).not.toBeNull();
                });

                await waitFor(async() => {
                    sourcesAndFreeproxies = await commanderApp.frontendClient.getAllProjectSourcesAndFreeproxiesById(
                        project.id,
                        connector.id
                    );

                    expect(sourcesAndFreeproxies.freeproxies)
                        .toHaveLength(1);

                    const freeproxy = sourcesAndFreeproxies.freeproxies[ 0 ];
                    expect(freeproxy.type)
                        .toBe(EProxyType.HTTP);
                    expect(freeproxy.key)
                        .toBe(`localhost:${proxy.port}`);
                    expect(freeproxy.address)
                        .toEqual({
                            hostname: 'localhost',
                            port: proxy.port,
                        });
                    expect(freeproxy.auth)
                        .toBeNull();
                    expect(freeproxy.fingerprint).not.toBeNull();
                });
            }
        );

        it(
            'should add an offline proxy',
            async() => {
                await commanderApp.frontendClient.createFreeproxies(
                    project.id,
                    connector.id,
                    [
                        {
                            type: EProxyType.HTTP,
                            key: '1.2.3.4:1337',
                            address: {
                                hostname: '1.2.3.4',
                                port: 1337,
                            },
                            auth: null,
                        },
                    ]
                );

                await waitFor(() => {
                    expect(client.freeproxies)
                        .toHaveLength(2);

                    const freeproxy = client.freeproxies.find((p) => p.key === '1.2.3.4:1337');
                    expect(freeproxy!.fingerprintError)
                        .toBe('socket hang up');
                });
            }
        );

        it(
            'should remove all offline proxies',
            async() => {
                await commanderApp.frontendClient.removeFreeproxies(
                    project.id,
                    connector.id,
                    {
                        onlyOffline: true,
                    }
                );

                await waitFor(() => {
                    expect(client.freeproxies)
                        .toHaveLength(1);
                });
            }
        );

        it(
            'should not update connector with a freeproxy unreachable timeout below disconnected timeout',
            async() => {
                const connectorFound = await commanderApp.frontendClient.getConnectorById(
                    project.id,
                    connector.id
                );
                const config = connectorFound.config as IConnectorFreeproxyConfig;
                config.freeproxiesTimeoutUnreachable = {
                    enabled: true,
                    value: config.freeproxiesTimeoutDisconnected - 1,
                };

                await expect(commanderApp.frontendClient.updateConnector(
                    project.id,
                    connector.id,
                    {
                        name: connectorFound.name,
                        credentialId: connectorFound.credentialId,
                        proxiesMax: connectorFound.proxiesMax,
                        proxiesTimeoutDisconnected: connectorFound.proxiesTimeoutDisconnected,
                        proxiesTimeoutUnreachable: connectorFound.proxiesTimeoutUnreachable,
                        config,
                    }
                )).rejects.toThrowError('Request failed with status code 500');
            }
        );

        it(
            'should update connector with freeproxy timeout renewal enable',
            async() => {
                const connectorFound = await commanderApp.frontendClient.getConnectorById(
                    project.id,
                    connector.id
                );
                const config = connectorFound.config as IConnectorFreeproxyConfig;
                config.freeproxiesTimeoutUnreachable.enabled = true;

                await commanderApp.frontendClient.updateConnector(
                    project.id,
                    connector.id,
                    {
                        name: connectorFound.name,
                        credentialId: connectorFound.credentialId,
                        proxiesMax: connectorFound.proxiesMax,
                        proxiesTimeoutDisconnected: connectorFound.proxiesTimeoutDisconnected,
                        proxiesTimeoutUnreachable: connectorFound.proxiesTimeoutUnreachable,
                        config,
                    }
                );
            }
        );

        it(
            'should add again an offline proxy',
            async() => {
                await commanderApp.frontendClient.createFreeproxies(
                    project.id,
                    connector.id,
                    [
                        {
                            type: EProxyType.HTTP,
                            key: '1.2.3.4:1337',
                            address: {
                                hostname: '1.2.3.4',
                                port: 1337,
                            },
                            auth: null,
                        },
                    ]
                );

                await waitFor(() => {
                    expect(client.freeproxies)
                        .toHaveLength(2);
                });
            }
        );

        it(
            'should auto-remove all offline proxies',
            async() => {
                await waitFor(
                    () => {
                        expect(client.freeproxies)
                            .toHaveLength(1);
                    },
                    20
                );
            }
        );

        it(
            'should activate the connector',
            async() => {
                await commanderApp.frontendClient.activateConnector(
                    project.id,
                    connector.id,
                    true
                );

                await waitFor(
                    async() => {
                        const views = await commanderApp.frontendClient.getAllProjectConnectorsAndProxiesById(project.id);
                        expect(countProxiesOnlineViews(views))
                            .toBe(1);
                    },
                    20
                );
            },
            20 * ONE_SECOND_IN_MS
        );

        it(
            'should make a request',
            async() => {
                const res = await instance.get(
                    `${servers.urlHttp}/mirror/headers`,
                    {
                        headers: {
                            'Proxy-Authorization': `Basic ${token}`,
                        },
                        proxy: {
                            host: 'localhost',
                            port: masterApp.masterPort,
                            protocol: 'http',
                        },
                    }
                );

                expect(res.status)
                    .toBe(200);
            }
        );

        it(
            'should remove the proxy from freeproxies list',
            async() => {
                // Create and activate connector
                const ids = sourcesAndFreeproxies.freeproxies.map((p) => p.id);
                await commanderApp.frontendClient.removeFreeproxies(
                    project.id,
                    connector.id,
                    {
                        ids,
                    }
                );
            }
        );

        it(
            'should have no proxy in freeproxies list',
            async() => {
                await waitFor(() => {
                    expect(client.freeproxies)
                        .toHaveLength(0);
                });

                await waitFor(async() => {
                    sourcesAndFreeproxies = await commanderApp.frontendClient.getAllProjectSourcesAndFreeproxiesById(
                        project.id,
                        connector.id
                    );

                    expect(sourcesAndFreeproxies.freeproxies)
                        .toHaveLength(0);
                });
            }
        );
    }
);
