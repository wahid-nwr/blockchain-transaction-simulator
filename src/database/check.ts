import { prisma } from './prisma.js';

async function main() {
    const result = await prisma.$queryRaw` SELECT NOW();`;
    console.log(result);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
