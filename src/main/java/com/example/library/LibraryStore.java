package com.example.library;

import java.sql.Connection;
import java.time.LocalDate;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
class LocalDatabaseConfiguration {
    @Bean
    DataSource dataSource() {
        return new DriverManagerDataSource("jdbc:h2:mem:library_preview;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
    }
}

@Component
public class LibraryStore {
    public record Context(JdbcTemplate jdbc, TransactionTemplate tx, boolean demo, String label) {}
    private final Context preview;
    private volatile Context current;

    public LibraryStore(DataSource dataSource) {
        new ResourceDatabasePopulator(new ClassPathResource("demo-schema.sql"), new ClassPathResource("demo-data.sql")).execute(dataSource);
        preview = context(dataSource, true, "示例预览");
        current = preview;
    }

    private Context context(DataSource source, boolean demo, String label) {
        return new Context(new JdbcTemplate(source), new TransactionTemplate(new DataSourceTransactionManager(source)), demo, label);
    }

    public Context get() { return current; }
    public synchronized void usePreview() { current = preview; }

    public synchronized void connect(String user, String password) {
        if (user == null || user.isBlank() || user.length() > 100 || password == null) throw new IllegalArgumentException("请填写数据库账号和密码");
        var source = new DriverManagerDataSource(
            "jdbc:mysql://127.0.0.1:3306/librarydb?sslMode=PREFERRED&allowPublicKeyRetrieval=true&connectionTimeZone=Asia/Shanghai&connectTimeout=5000&socketTimeout=10000&characterEncoding=UTF-8", user.trim(), password);
        try (Connection connection = source.getConnection()) {
            connection.setReadOnly(true);
            for (String sql : List.of(
                "SELECT typeno,typename,max_quantity,max_days FROM readertype WHERE 1=0",
                "SELECT rid,rname,sex,typeno,dept,tel FROM reader WHERE 1=0",
                "SELECT bid,bname,author,publisher,publishdate,price,total,position FROM book WHERE 1=0",
                "SELECT id,rid,bid,borrowtime,returntime FROM borrow WHERE 1=0")) {
                try (var statement = connection.createStatement(); var rs = statement.executeQuery(sql)) { }
            }
        } catch (Exception ex) {
            throw new IllegalArgumentException("连接失败：请确认 MySQL 已启动、账号密码正确，并且 librarydb 的四张表存在。当前数据来源保持原样。");
        }
        current = context(source, false, "MySQL · librarydb");
    }

    public static List<Map<String, Object>> rows(Context c, String sql, Object... args) {
        return c.jdbc().query(sql, (rs, n) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            var meta = rs.getMetaData();
            for (int i = 1; i <= meta.getColumnCount(); i++) {
                Object value = rs.getObject(i);
                if (value instanceof java.sql.Date date) value = date.toLocalDate().toString();
                row.put(meta.getColumnLabel(i).toLowerCase(java.util.Locale.ROOT), value);
            }
            return row;
        }, args);
    }

    public static Map<String, Object> one(Context c, String sql, Object... args) {
        var results = rows(c, sql, args);
        if (results.isEmpty()) throw new IllegalArgumentException("记录不存在，可能已被删除，请刷新页面");
        return results.getFirst();
    }

    public static long count(Context c, String sql, Object... args) {
        Long result = c.jdbc().queryForObject(sql, Long.class, args);
        return result == null ? 0 : result;
    }

    public static LocalDate today() { return LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")); }
}
