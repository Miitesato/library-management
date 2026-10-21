package com.example.library;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class LibraryController {
    private final LibraryService service;
    private final LibraryStore store;
    public LibraryController(LibraryService service,LibraryStore store) { this.service=service; this.store=store; }
    @GetMapping("/data") public Map<String,Object> data() { return service.snapshot(); }
    @PostMapping("/connection") public Map<String,Object> connect(@RequestBody Map<String,String> body) {
        store.connect(body.get("username"),body.get("password")); return Map.of("message","已连接本机 MySQL，正在使用 librarydb");
    }
    @PostMapping("/preview") public Map<String,Object> preview() { store.usePreview(); return Map.of("message","已切换到示例预览"); }
    @PostMapping("/books") public Map<String,Object> createBook(@RequestBody Map<String,Object> body) {service.saveBook(null,body);return ok("图书已入库");}
    @PutMapping("/books/{id}") public Map<String,Object> editBook(@PathVariable String id,@RequestBody Map<String,Object> body) {service.saveBook(id,body);return ok("图书信息已更新");}
    @DeleteMapping("/books/{id}") public Map<String,Object> deleteBook(@PathVariable String id) {service.deleteBook(id);return ok("图书已删除");}
    @PostMapping("/readers") public Map<String,Object> createReader(@RequestBody Map<String,Object> body) {service.saveReader(null,body);return ok("读者已添加");}
    @PutMapping("/readers/{id}") public Map<String,Object> editReader(@PathVariable String id,@RequestBody Map<String,Object> body) {service.saveReader(id,body);return ok("读者信息已更新");}
    @DeleteMapping("/readers/{id}") public Map<String,Object> deleteReader(@PathVariable String id) {service.deleteReader(id);return ok("读者已删除");}
    @PostMapping("/borrows") public Map<String,Object> borrow(@RequestBody Map<String,Object> body) {service.borrow(body);return ok("借阅成功，库存已同步更新");}
    @PostMapping("/borrows/{id}/return") public Map<String,Object> returnBook(@PathVariable int id) {service.returnBook(id);return ok("归还成功，库存已同步更新");}
    private Map<String,Object> ok(String message) {return Map.of("message",message);}
}

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(DuplicateKeyException.class)
    ResponseEntity<?> duplicate() {return ResponseEntity.badRequest().body(Map.of("message","编号已存在，请使用其他编号"));}
    @ExceptionHandler({IllegalArgumentException.class,java.time.DateTimeException.class,org.springframework.http.converter.HttpMessageNotReadableException.class})
    ResponseEntity<?> badRequest(Exception ex) {return ResponseEntity.badRequest().body(Map.of("message",ex instanceof org.springframework.http.converter.HttpMessageNotReadableException?"请求格式有误，请检查表单":ex.getMessage()));}
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<?> databaseError() {return ResponseEntity.status(409).body(Map.of("message","数据库操作失败，请检查连接、字段约束和账号权限；未完成的事务已回滚"));}
}
