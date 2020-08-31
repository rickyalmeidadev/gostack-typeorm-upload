import csvParse from 'csv-parse';
import fs from 'fs';
import { getRepository, In, getCustomRepository } from 'typeorm';

import Transaction from '../models/Transaction';
import Category from '../models/Category';
import TransactionsRepository from '../repositories/TransactionsRepository';

interface RequestDTO {
  path: string;
}

interface CVSTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: string;
  category: string;
}

class ImportTransactionsService {
  async execute({ path }: RequestDTO): Promise<Transaction[]> {
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    const readCSVStream = fs.createReadStream(path);

    const parseStream = csvParse({
      from_line: 2,
    });

    const parseCSV = readCSVStream.pipe(parseStream);

    const transactions: CVSTransaction[] = [];
    const categories: string[] = [];

    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) => {
        return cell.trim();
      });

      if (!title || !type || !value) {
        return;
      }

      transactions.push({ title, type, value, category });
      categories.push(category);
    });

    await new Promise(resolve => parseCSV.on('end', resolve));

    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    const existentCategoriesTitle = existentCategories.map(category => {
      return category.title;
    });

    const nonExistentCategories = categories.filter((category, index, self) => {
      return (
        !existentCategoriesTitle.includes(category) &&
        self.indexOf(category) === index
      );
    });

    const newCategories = categoriesRepository.create(
      nonExistentCategories.map(category => ({
        title: category,
      })),
    );

    await categoriesRepository.save(newCategories);

    const allCategories = [...existentCategories, ...newCategories];

    const newTransactions = transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: Number(transaction.value),
        category_id: allCategories.find(category => {
          return category.title === transaction.category;
        })?.id,
      })),
    );

    await transactionsRepository.save(newTransactions);

    await fs.promises.unlink(path);

    return newTransactions;
  }
}

export default ImportTransactionsService;
