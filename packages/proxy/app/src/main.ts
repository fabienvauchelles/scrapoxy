import { promises as fs } from 'fs';
import {
    Proxy,
    sigstop,
} from '@scrapoxy/proxy-sdk';
import type { IProxyLogger } from '@scrapoxy/proxy-sdk';


class ProxyLoggerConsole implements IProxyLogger {
    log(message: string) {
        console.log(message);
    }

    error(
        message: string, stack?: string
    ) {
        console.error(message);

        if (stack) {
            console.error(stack);
        }
    }

    debug(message: string) {
        console.debug(message);
    }
}


(async() => {
    const
        port = parseInt(
            process.env.PORT ?? '3128',
            10
        ),
        timeout = parseInt(
            process.env.TIMEOUT ?? '60000', // One minute
            10
        );
    const [
        cert, key,
    ] = await Promise.all([
        fs.readFile('certificate.pem')
            .then((buffer) => buffer.toString()),
        fs.readFile('certificate.key')
            .then((buffer) => buffer.toString()),
    ]);
    const logger = new ProxyLoggerConsole();
    const proxy = new Proxy(
        logger,
        timeout,
        cert,
        key
    );

    sigstop(() => {
        proxy.close()
            .catch((err: any) => {
                logger.error(err);
            });
    });

    await proxy.listen(port);
})()
    .catch((err: any) => {
        console.error(err);
    });
